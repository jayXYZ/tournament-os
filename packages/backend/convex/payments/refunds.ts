import { v } from "convex/values";

import { refundAmountCents } from "@tournament-os/shared/payment-fees";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import type { AuditActorRole } from "../model/auditLog";
import { logEntryPaymentAudit } from "../model/auditLog";
import {
  moneyRowOwnerArgs,
  moneyRowOwnerColumns,
  ownerOrdersQuery,
  parseMoneyRowOwner,
} from "../model/paidEventOwner";
import type {
  AnyEntryRegistration,
  AnyEntryRegistrationId,
  PaidEventRef,
} from "../model/payments";
import {
  hasPriorPlayerCancelFullRefund,
  isOpenOrderStatus,
  OPEN_ORDER_STATUSES,
  ordersForRegistration,
  paidEntryRefundWindowOpen,
  refundsReturningForOrder,
} from "../model/payments";
import { getStripeGateway } from "../stripe/client";
import { requireStripeSecretKey } from "../stripe/config";
import { isDefinitiveStripeFailure } from "../stripe/errors";

// Refund execution. A refund is queued as a pending paymentRefunds row inside
// whatever mutation decided it (webhook race, player cancel, organizer
// removal, cancellation sweep), then a scheduled action performs the single
// Stripe call and a mutation records the outcome — so every state change
// stays transactional and the Stripe call is idempotent per refund row.

export async function queueRefund(
  ctx: MutationCtx,
  args: {
    order: Doc<"paymentOrders">;
    registration: AnyEntryRegistration;
    kind: Doc<"paymentRefunds">["kind"];
    reason: Doc<"paymentRefunds">["reason"];
    // The processing-fee estimate deducted from the organizer's payout;
    // 0 when nobody attributable absorbs it (seat_unavailable, entry_only).
    absorbedFeeCents: number;
    // Overrides the kind-derived amount where the kind alone can't say it:
    // the cancellation sweep returning whatever a charge still owes, or a
    // stray charge refunding its session's total.
    amountCentsOverride?: number;
    // Refund a charge other than the order's recorded one (a payment that
    // landed on a superseded session). Such a refund never drives the
    // order's status.
    stripeChargeId?: string;
    initiatedBy?: { actor: Doc<"users">; actorRole: "player" | "organizer" };
  },
) {
  const amountCents =
    args.amountCentsOverride ??
    refundAmountCents(args.order.amountBreakdown, args.kind);
  const refundId = await ctx.db.insert("paymentRefunds", {
    orderId: args.order._id,
    // The owner pair copies straight off the order — the single place the
    // exactly-one-of invariant was established (createEntryOrder).
    tournamentId: args.order.tournamentId,
    conventionId: args.order.conventionId,
    registrationId: args.order.registrationId,
    participantId: args.order.participantId,
    kind: args.kind,
    reason: args.reason,
    amountCents,
    absorbedFeeCents: args.absorbedFeeCents,
    stripeChargeId: args.stripeChargeId,
    status: "pending",
    initiatedByUserId: args.initiatedBy?.actor._id,
    updatedAt: Date.now(),
  });
  await logEntryPaymentAudit(ctx, {
    owner: args.order,
    registration: args.registration,
    ...(args.initiatedBy ?? { actorRole: "system" as const }),
    event: {
      type: "refund_issued",
      kind: args.kind,
      reason: args.reason,
      amountCents,
    },
  });
  await ctx.scheduler.runAfter(0, internal.payments.refunds.executeRefund, {
    refundId,
  });
  return refundId;
}

// Closes the registration's open (unpaid) orders and expires their Checkout
// sessions, so the decision that removed the entry from payment's path — an
// exit, or a waitlist hold — leaves nothing payable behind for the player to
// complete anyway.
export async function closeOpenOrdersForRegistration(
  ctx: MutationCtx,
  registrationId: AnyEntryRegistrationId,
) {
  const orders = await ordersForRegistration(ctx, registrationId);
  for (const order of orders) {
    if (!isOpenOrderStatus(order.status)) {
      continue;
    }
    await ctx.db.patch(order._id, {
      status: "canceled",
      updatedAt: Date.now(),
    });
    if (order.stripeCheckoutSessionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.checkout.expireAbandonedSession,
        { sessionId: order.stripeCheckoutSessionId },
      );
    }
  }
}

// Settles a registration's orders when its entry leaves the event pre-start
// (a player cancellation or an organizer rejection/removal — the roster and
// badge verbs call this after the entry-state change). Open orders close and
// their sessions expire; a paid order refunds by whose decision the exit
// was: an organizer removal always refunds in full with the organizer
// absorbing the processing fee, while a player cancellation runs the refund
// window and the repeat-drop rule. Past the window the order simply stays
// paid and flows into the payout.
export async function settleOrdersOnEntryExit(
  ctx: MutationCtx,
  args: {
    owner: PaidEventRef;
    registration: AnyEntryRegistration;
    actor: Doc<"users">;
    actorRole: AuditActorRole;
  },
) {
  await closeOpenOrdersForRegistration(ctx, args.registration._id);
  const orders = await ordersForRegistration(ctx, args.registration._id);
  for (const order of orders) {
    if (order.status !== "paid") {
      continue;
    }
    // An order stays "paid" until its refund settles, so a second exit on
    // the same registration (a player cancel followed by an organizer bar)
    // must not queue another refund against money already coming back.
    if ((await refundsReturningForOrder(ctx, order._id)).length > 0) {
      continue;
    }

    if (args.actorRole === "player") {
      if (!paidEntryRefundWindowOpen(args.owner, Date.now())) {
        continue;
      }
      const repeatDrop = await hasPriorPlayerCancelFullRefund(
        ctx,
        args.owner,
        args.registration.participantId,
      );
      await queueRefund(ctx, {
        order,
        registration: args.registration,
        kind: repeatDrop ? "entry_only" : "full",
        reason: "player_cancel",
        absorbedFeeCents: repeatDrop
          ? 0
          : order.amountBreakdown.processingFeeCents,
        initiatedBy: { actor: args.actor, actorRole: "player" },
      });
    } else {
      await queueRefund(ctx, {
        order,
        registration: args.registration,
        kind: "full",
        reason: "organizer_remove",
        absorbedFeeCents: order.amountBreakdown.processingFeeCents,
        initiatedBy: { actor: args.actor, actorRole: "organizer" },
      });
    }
  }
}

const SWEEP_BATCH = 32;

// Closes every open (unpaid) order for an event — scheduled when it starts
// (unpaid approvals lapse; they never seat) and as the first stage of the
// cancellation sweep. Terminates because closed orders leave the queried
// status ranges.
export const closeOpenOrdersSweep = internalMutation({
  args: moneyRowOwnerArgs,
  handler: async (ctx, args) => {
    const owner = parseMoneyRowOwner(args);
    let sawFullPage = false;
    for (const status of OPEN_ORDER_STATUSES) {
      const orders = await ownerOrdersQuery(ctx, owner, status).take(
        SWEEP_BATCH,
      );
      sawFullPage ||= orders.length === SWEEP_BATCH;
      for (const order of orders) {
        await ctx.db.patch(order._id, {
          status: "canceled",
          updatedAt: Date.now(),
        });
        if (order.stripeCheckoutSessionId) {
          await ctx.scheduler.runAfter(
            0,
            internal.payments.checkout.expireAbandonedSession,
            { sessionId: order.stripeCheckoutSessionId },
          );
        }
      }
    }
    if (sawFullPage) {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.closeOpenOrdersSweep,
        args,
      );
    }
    return null;
  },
});

// The cancellation sweep: a cancelled paid event makes every player whole.
// Open orders close, and every paid or partially-refunded order refunds
// whatever its charge still owes — the event never happening outranks the
// repeat-drop rule, and refunds already pending or settled (a player cancel
// racing the cancellation, a repeat drop's entry-only refund) are counted
// rather than double-issued, so the queued amount can never exceed what
// Stripe still holds. No payout exists to deduct from, so the platform
// absorbs the processing fees (absorbedFeeCents 0). Paid orders keep their
// status until their refund settles, so idempotency across batches comes
// from the per-order existing-refund guard and progress from the cursor.
export const cancelEventPaymentsSweep = internalMutation({
  args: {
    ...moneyRowOwnerArgs,
    stage: v.optional(v.union(v.literal("paid"), v.literal("remainder"))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const owner = parseMoneyRowOwner(args);
    const stage = args.stage ?? "paid";
    const status =
      stage === "paid" ? ("paid" as const) : ("partially_refunded" as const);
    const cancelReason =
      owner.kind === "convention"
        ? ("convention_cancelled" as const)
        : ("tournament_cancelled" as const);
    const { page, isDone, continueCursor } = await ownerOrdersQuery(
      ctx,
      owner,
      status,
    ).paginate({ numItems: SWEEP_BATCH, cursor: args.cursor ?? null });

    for (const order of page) {
      const refunds = await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(64);
      if (refunds.some((refund) => refund.reason === cancelReason)) {
        continue;
      }
      // Failed refunds returned nothing and stray-charge refunds returned a
      // different charge's money; everything else is already coming back.
      const alreadyReturningCents = refunds
        .filter(
          (refund) =>
            refund.status !== "failed" && refund.stripeChargeId === undefined,
        )
        .reduce((sum, refund) => sum + refund.amountCents, 0);
      const remainingCents =
        order.amountBreakdown.totalCents - alreadyReturningCents;
      if (remainingCents <= 0) {
        continue;
      }
      const registration = await ctx.db.get(order.registrationId);
      if (!registration) {
        continue;
      }
      await queueRefund(ctx, {
        order,
        registration,
        kind: "full",
        reason: cancelReason,
        absorbedFeeCents: 0,
        amountCentsOverride: remainingCents,
      });
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.cancelEventPaymentsSweep,
        { ...moneyRowOwnerColumns(owner), stage, cursor: continueCursor },
      );
    } else if (stage === "paid") {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.cancelEventPaymentsSweep,
        { ...moneyRowOwnerColumns(owner), stage: "remainder", cursor: null },
      );
    }
    return null;
  },
});

export const beginRefundExecution = internalMutation({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.status !== "pending") {
      return null;
    }
    const order = await ctx.db.get(refund.orderId);
    const chargeId = refund.stripeChargeId ?? order?.stripeChargeId;
    if (!chargeId) {
      // A paid order always carries its charge id (the webhook records it
      // before any refund is queued); a missing one is unexecutable.
      await ctx.db.patch(args.refundId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      return null;
    }
    return {
      stripeChargeId: chargeId,
      amountCents: refund.amountCents,
    };
  },
});

const REFUND_RETRY_DELAY_MS = 60_000;
const MAX_REFUND_ATTEMPTS = 5;

export const executeRefund = internalAction({
  args: {
    refundId: v.id("paymentRefunds"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const begin: { stripeChargeId: string; amountCents: number } | null =
      await ctx.runMutation(internal.payments.refunds.beginRefundExecution, {
        refundId: args.refundId,
      });
    if (!begin) {
      return null;
    }

    const gateway = getStripeGateway(requireStripeSecretKey());
    let created: {
      stripeRefundId: string;
      status:
        | "pending"
        | "requires_action"
        | "succeeded"
        | "failed"
        | "canceled";
    };
    try {
      created = await gateway.createRefund({
        chargeId: begin.stripeChargeId,
        amountCents: begin.amountCents,
        refundRowId: args.refundId,
        idempotencyKey: `refund:${args.refundId}`,
      });
    } catch (error) {
      // Only a definitive Stripe rejection settles the row as failed. An
      // ambiguous failure (a connection drop, a Stripe 5xx) can land AFTER
      // Stripe created the refund, and a row settled "failed" would keep its
      // order in the payout while the charge's money went back — so the row
      // stays pending and the call retries under its idempotency key, with
      // refund.updated reconciliation settling whichever truth emerges.
      if (isDefinitiveStripeFailure(error)) {
        await (ctx.runMutation(internal.payments.refunds.markRefundResult, {
          refundId: args.refundId,
          outcome: "failed",
        }) satisfies Promise<null>);
      } else if ((args.attempt ?? 1) < MAX_REFUND_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          REFUND_RETRY_DELAY_MS,
          internal.payments.refunds.executeRefund,
          { refundId: args.refundId, attempt: (args.attempt ?? 1) + 1 },
        );
      }
      // Rethrown so the failure is visible in function logs; the refund row
      // and refund_failed audit line carry the user-facing record.
      throw error;
    }
    // Stripe accepting the creation is not the money moving: a refund can
    // come back pending (bank rails) or requires_action, and only its
    // terminal status settles the row — for the in-between states the row
    // stays pending, carrying the Stripe id so the refund.updated webhook
    // can settle it.
    const outcome =
      created.status === "succeeded"
        ? ("succeeded" as const)
        : created.status === "failed" || created.status === "canceled"
          ? ("failed" as const)
          : ("pending" as const);
    await (ctx.runMutation(internal.payments.refunds.markRefundResult, {
      refundId: args.refundId,
      outcome,
      stripeRefundId: created.stripeRefundId,
    }) satisfies Promise<null>);
    return null;
  },
});

// Applies a refund outcome to a pending refund row (and its order). Shared
// by the executor's result write and webhook reconciliation; rows already
// settled are left alone, with one exception: reconciliation may flip a
// "failed" row to succeeded (recoverFailed), because a refund.updated
// success is Stripe's proof the money moved and outranks whatever local
// error settled the row.
async function applyRefundOutcome(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  outcome: "succeeded" | "failed",
  stripeRefundId?: string,
  opts?: { recoverFailed?: boolean },
) {
  const applies =
    refund.status === "pending" ||
    (opts?.recoverFailed === true &&
      refund.status === "failed" &&
      outcome === "succeeded");
  if (!applies) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(refund._id, {
    status: outcome,
    stripeRefundId: stripeRefundId ?? refund.stripeRefundId,
    updatedAt: now,
  });

  if (outcome === "succeeded") {
    // A stray-charge refund returned money that never belonged to the
    // order's own charge; the order's status is not its business.
    if (refund.stripeChargeId !== undefined) {
      return;
    }
    const order = await ctx.db.get(refund.orderId);
    if (order) {
      // Derived from what has actually come back rather than this refund's
      // kind, so two refunds settling out of order (an entry-only refund and
      // the cancellation sweep's fee remainder) land on the same terminal
      // status regardless of which settles last.
      const settled = await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(64);
      const returnedCents = settled
        .filter(
          (row) =>
            (row._id === refund._id || row.status === "succeeded") &&
            row.stripeChargeId === undefined,
        )
        .reduce((sum, row) => sum + row.amountCents, 0);
      await ctx.db.patch(order._id, {
        status:
          returnedCents >= order.amountBreakdown.totalCents
            ? "refunded"
            : "partially_refunded",
        updatedAt: now,
      });
    }
    return;
  }

  const registration = await ctx.db.get(refund.registrationId);
  if (registration) {
    await logEntryPaymentAudit(ctx, {
      owner: refund,
      registration,
      actorRole: "system",
      event: {
        type: "refund_failed",
        amountCents: refund.amountCents,
      },
    });
  }
}

export const markRefundResult = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    outcome: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      // The Stripe call landed but the refund is still processing: record
      // the Stripe id (the webhook's lookup key) and leave the row pending
      // for refund.updated to settle.
      v.literal("pending"),
    ),
    stripeRefundId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund) {
      return null;
    }
    if (args.outcome === "pending") {
      if (refund.status === "pending" && args.stripeRefundId) {
        await ctx.db.patch(refund._id, {
          stripeRefundId: args.stripeRefundId,
          updatedAt: Date.now(),
        });
      }
      return null;
    }
    await applyRefundOutcome(ctx, refund, args.outcome, args.stripeRefundId);
    return null;
  },
});

// Reconciliation from Stripe's refund lifecycle events: recovers a pending
// row whose executor crashed between the Stripe call and the result write,
// and a "failed" row Stripe reports succeeded (the executor's error was
// wrong about the money). A succeeded row stays succeeded (a post-success
// flip is rare enough to be a support case, not an automated rewrite), and
// refunds issued outside the app (dashboard) have no row and are ignored.
export const handleRefundEvent = internalMutation({
  args: {
    stripeEventId: v.string(),
    stripeRefundId: v.string(),
    refundStatus: v.string(),
    // The paymentRefunds row id from the refund's metadata: the fallback
    // lookup for a row whose executor crashed before recording the Stripe
    // refund id.
    refundRowId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const alreadyProcessed = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .unique();
    if (alreadyProcessed) {
      return null;
    }
    await ctx.db.insert("stripeWebhookEvents", {
      stripeEventId: args.stripeEventId,
      type: "refund.updated",
      processedAt: Date.now(),
    });

    let refund = await ctx.db
      .query("paymentRefunds")
      .withIndex("by_stripeRefundId", (q) =>
        q.eq("stripeRefundId", args.stripeRefundId),
      )
      .unique();
    if (!refund && args.refundRowId) {
      const rowId = ctx.db.normalizeId("paymentRefunds", args.refundRowId);
      refund = rowId ? await ctx.db.get(rowId) : null;
    }
    if (!refund) {
      return null;
    }
    if (args.refundStatus === "succeeded") {
      await applyRefundOutcome(ctx, refund, "succeeded", args.stripeRefundId, {
        recoverFailed: true,
      });
    } else if (
      args.refundStatus === "failed" ||
      args.refundStatus === "canceled"
    ) {
      await applyRefundOutcome(ctx, refund, "failed", args.stripeRefundId);
    }
    return null;
  },
});
