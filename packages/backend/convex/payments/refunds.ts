import { v } from "convex/values";

import { refundAmountCents } from "@paper-pairings/shared/payment-fees";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "../_generated/server";
import type { AuditActorRole, PaidEntryAuditEvent } from "../model/auditLog";
import { logEntryPaymentAudit } from "../model/auditLog";
import {
  moneyRowOwnerArgs,
  moneyRowOwnerColumns,
  ownerOrdersQuery,
  parseMoneyRowOwner,
} from "../model/paidEventOwner";
import { requireConventionOrganizerAccess } from "../model/conventions";
import { requireOwnerPaymentsPermission } from "../model/stripeAccounts";
import { requireOrganizerAccess } from "../model/tournaments";
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
  patchOrder,
  refundsNeedingAttention,
  refundsReturningForOrder,
} from "../model/payments";
import {
  getStripeGateway,
  type StripeGateway,
  type StripeRefundStatus,
} from "../stripe/client";
import { requireStripeSecretKey } from "../stripe/config";
import { errorMessageOf, isDefinitiveStripeFailure } from "../stripe/errors";

// Refund execution. A refund is queued as a pending paymentRefunds row inside
// whatever mutation decided it (webhook race, player cancel, organizer
// removal, cancellation sweep), then a scheduled action performs the single
// Stripe call and a mutation records the outcome — so every state change
// stays transactional and the Stripe call is idempotent per refund row.
//
// The contract the executor keeps (docs/refund-recovery.md): a row settles
// "failed" only on proof that no request created a refund, and whenever the
// outcome is unknown — retries exhausted, a rejection after an earlier
// uncertain attempt, an execution that died before reporting — the row
// parks in needs_attention, where it blocks the payout and the event's
// deletion until Stripe's record (the refund.updated webhook, or the
// owner's checkRefundStatus) says what happened. Nothing creates a refund
// outside the row's original bounded execution.

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
    attemptCount: 0,
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
  await scheduleRefundExecution(ctx, refundId, 0, 0);
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
    await patchOrder(ctx, order, {
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
        await patchOrder(ctx, order, {
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
      // different charge's money; everything else (pending, succeeded, and
      // needs_attention rows whose Stripe outcome is unknown) is already
      // coming back.
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

const REFUND_RETRY_DELAY_MS = 60_000;
export const MAX_REFUND_ATTEMPTS = 5;

// How long after a refund row is queued its executor may still send the
// create request. Every attempt replays one idempotency key, and Stripe
// keeps a key for at least 24 hours: a replay past that would be a fresh
// request, honoured a second time if a lost earlier attempt had already
// refunded the charge. Six hours is well past the five-minute retry
// schedule yet leaves the better part of a day for the action's own
// runtime (Stripe's client retries, Convex's action limit) before the key
// could lapse. The row's creation time bounds the first request from below,
// so no attempt needs its own timestamp.
export const REFUND_CREATE_WINDOW_MS = 6 * 60 * 60 * 1000;

// How long after an execution's scheduled time its guard first looks in on
// it, and how often it looks again while the execution is still queued or
// running. Longer than a healthy execution (one Stripe call) by a wide
// margin, so the guard almost always finds the row already spoken for.
const REFUND_GUARD_DELAY_MS = 2 * 60_000;

// Queues one execution of the refund and, in the same transaction, the
// guard that looks in on it (guardRefundExecution) — the one way an
// execution is ever scheduled, so no execution can run unobserved. The
// guard carries the attempt count the row holds now: a later attempt bumps
// it, which is how an earlier execution's guard recognises that it has
// been superseded.
async function scheduleRefundExecution(
  ctx: MutationCtx,
  refundId: Id<"paymentRefunds">,
  attemptCount: number,
  delayMs: number,
) {
  const executionId = await ctx.scheduler.runAfter(
    delayMs,
    internal.payments.refunds.executeRefund,
    { refundId },
  );
  await ctx.scheduler.runAfter(
    delayMs + REFUND_GUARD_DELAY_MS,
    internal.payments.refunds.guardRefundExecution,
    { refundId, executionId, attemptCount },
  );
}

// Parks a pending row in needs_attention with the diagnostic that explains
// the unknown outcome, and writes the one refund_stalled audit line. The
// row keeps its attempt count and blocks the payout and the event's
// deletion until Stripe's record settles it; nothing automatic touches it
// again.
async function parkRefund(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  lastError: string,
) {
  await ctx.db.patch(refund._id, {
    status: "needs_attention",
    lastError,
    updatedAt: Date.now(),
  });
  await logRefundAudit(ctx, refund, {
    type: "refund_stalled",
    amountCents: refund.amountCents,
  });
}

// The executor's precondition check: the row is still pending, Stripe has
// not yet accepted a refund for it, and the create window is open. Returns
// what the Stripe call needs, or null when there is nothing to send — the
// row was settled or parked meanwhile, or it is settled or parked here.
export const beginRefundExecution = internalMutation({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    // Once Stripe holds a refund for the row (stripeRefundId), only that
    // refund's status matters: a create replayed past the key's life would
    // be a second refund, so a pending row with an id waits for the webhook
    // or a status check instead.
    if (
      !refund ||
      refund.status !== "pending" ||
      refund.stripeRefundId !== undefined
    ) {
      return null;
    }
    if (Date.now() - refund._creationTime > REFUND_CREATE_WINDOW_MS) {
      await parkRefund(
        ctx,
        refund,
        "The retry window closed before this attempt could be sent; whether an earlier attempt reached Stripe is unknown",
      );
      return null;
    }
    const order = await ctx.db.get(refund.orderId);
    const chargeId = refund.stripeChargeId ?? order?.stripeChargeId;
    if (!chargeId) {
      // A paid order always carries its charge id (the webhook records it
      // before any refund is queued), so this is a data fault. With no
      // attempt sent it is a plain failure; after one, the outcome of that
      // attempt is as unknown as any other, so the row parks.
      const diagnostic = "The order has no Stripe charge to refund";
      if (refund.attemptCount === 0) {
        await applyRefundOutcome(ctx, refund, "failed", {
          lastError: diagnostic,
        });
      } else {
        await parkRefund(ctx, refund, diagnostic);
      }
      return null;
    }
    return { stripeChargeId: chargeId, amountCents: refund.amountCents };
  },
});

// Stripe accepting a refund is not the money moving: a refund can sit
// pending (bank rails) or requires_action, and only its terminal status
// settles the row — for the in-between states the row stays pending,
// carrying the Stripe id so the refund.updated webhook can settle it.
function refundOutcomeFromStatus(status: StripeRefundStatus) {
  return status === "succeeded"
    ? ("succeeded" as const)
    : status === "failed" || status === "canceled"
      ? ("failed" as const)
      : ("pending" as const);
}

// One attempt at the row's Stripe call. Each outcome is recorded by one
// mutation: a returned refund by markRefundResult, a thrown call by
// recordRefundAttemptFailure, which decides whether the attempt is
// retried, settled, or parked. Every attempt replays the same idempotency
// key, so a retry can only ever return the refund an earlier attempt
// created, never a second one.
export const executeRefund = internalAction({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args) => {
    const begin: { stripeChargeId: string; amountCents: number } | null =
      await ctx.runMutation(internal.payments.refunds.beginRefundExecution, {
        refundId: args.refundId,
      });
    if (!begin) {
      return null;
    }
    const gateway = getStripeGateway(requireStripeSecretKey());
    let created: { stripeRefundId: string; status: StripeRefundStatus };
    try {
      created = await gateway.createRefund({
        chargeId: begin.stripeChargeId,
        amountCents: begin.amountCents,
        refundRowId: args.refundId,
        idempotencyKey: `refund:${args.refundId}`,
      });
    } catch (error) {
      await (ctx.runMutation(
        internal.payments.refunds.recordRefundAttemptFailure,
        {
          refundId: args.refundId,
          errorMessage: errorMessageOf(error),
          definitive: isDefinitiveStripeFailure(error),
        },
      ) satisfies Promise<null>);
      // Rethrown so the failure is visible in function logs; the refund
      // row carries the user-facing record.
      throw error;
    }
    await (ctx.runMutation(internal.payments.refunds.markRefundResult, {
      refundId: args.refundId,
      outcome: refundOutcomeFromStatus(created.status),
      stripeRefundId: created.stripeRefundId,
    }) satisfies Promise<null>);
    return null;
  },
});

// Appends a refund lifecycle event to the owning event's audit log,
// attributed to the system (the executor and webhooks have no acting user).
// A refund whose registration is gone has no log line to anchor to.
async function logRefundAudit(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  event: PaidEntryAuditEvent,
) {
  const registration = await ctx.db.get(refund.registrationId);
  if (registration) {
    await logEntryPaymentAudit(ctx, {
      owner: refund,
      registration,
      actorRole: "system",
      event,
    });
  }
}

// Records one thrown Stripe call on the row and decides what follows, in
// the same transaction so a crash can never leave a counted attempt without
// its consequence:
//
// - A definitive rejection (stripe/errors.ts: the request reached Stripe and
//   was refused) on the row's first attempt proves no request created a
//   refund, so the row settles "failed" with the rejection as its error.
// - The same rejection after an earlier attempt proves only that THIS
//   request created nothing; the earlier one may have refunded the charge
//   (which may be exactly why Stripe refuses now). The row parks.
// - A retriable failure — ambiguous (a connection drop, a 5xx: the refund
//   may exist) or transient (a rate limit, a key mid-rotation) — retries
//   under the same key after a delay, until the attempt budget runs out and
//   the row parks. A 5xx Stripe cached under the key replays through the
//   remaining budget before parking: a few wasted calls, in exchange for
//   not giving up on a transient edge error a replay would have cleared.
//
// A parked row is never settled "failed": the refund is still owed, and
// only Stripe's record can say whether it was already paid.
export const recordRefundAttemptFailure = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    errorMessage: v.string(),
    definitive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.status !== "pending") {
      return null;
    }
    const attemptCount = refund.attemptCount + 1;
    await ctx.db.patch(refund._id, {
      attemptCount,
      lastError: args.errorMessage,
      updatedAt: Date.now(),
    });
    if (args.definitive && refund.attemptCount === 0) {
      await applyRefundOutcome(ctx, refund, "failed", {
        lastError: args.errorMessage,
      });
    } else if (args.definitive || attemptCount >= MAX_REFUND_ATTEMPTS) {
      await parkRefund(ctx, refund, args.errorMessage);
    } else {
      await scheduleRefundExecution(
        ctx,
        refund._id,
        attemptCount,
        REFUND_RETRY_DELAY_MS,
      );
    }
    return null;
  },
});

// The guard scheduled beside every execution (scheduleRefundExecution):
// closes the one gap the recording mutations cannot — an execution that
// died before any of them ran (a crash before the Stripe call, a runtime
// error after it), leaving a pending row nothing will ever touch again.
//
// The guard stands down the moment the row shows the execution, or a
// later attempt, spoke for itself: it is gone, settled, or parked; Stripe
// has accepted a refund for it (stripeRefundId, which a pending row keeps
// while the webhook settles it); or its attempt count has moved on. Only a
// row exactly as the execution found it is examined further, through the
// scheduler's own record of that execution: still queued or running, and
// the guard looks again later; ended without recording anything, and the
// row parks — the request may or may not have reached Stripe, which is
// precisely what needs_attention means. A record the scheduler no longer
// holds is read the same way. The guard never creates a refund and never
// declares one failed.
export const guardRefundExecution = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    executionId: v.id("_scheduled_functions"),
    attemptCount: v.number(),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (
      !refund ||
      refund.status !== "pending" ||
      refund.stripeRefundId !== undefined ||
      refund.attemptCount !== args.attemptCount
    ) {
      return null;
    }
    const execution = await ctx.db.system.get(
      "_scheduled_functions",
      args.executionId,
    );
    if (
      execution?.state.kind === "pending" ||
      execution?.state.kind === "inProgress"
    ) {
      await ctx.scheduler.runAfter(
        REFUND_GUARD_DELAY_MS,
        internal.payments.refunds.guardRefundExecution,
        args,
      );
      return null;
    }
    await parkRefund(
      ctx,
      refund,
      execution
        ? "Refund execution ended without recording an outcome; whether the request reached Stripe is unknown"
        : "Refund execution left no record and no outcome; whether the request reached Stripe is unknown",
    );
    return null;
  },
});

// Records that Stripe holds this row's refund and is still processing it:
// the Stripe id is the refund.updated webhook's lookup key, and a parked
// row comes back to pending — the money is moving, so it is no longer an
// operator's problem, and the stall's error no longer describes the row.
async function recordRefundInFlight(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  stripeRefundId: string,
) {
  if (refund.status !== "pending" && refund.status !== "needs_attention") {
    return;
  }
  await ctx.db.patch(refund._id, {
    status: "pending",
    stripeRefundId,
    lastError: undefined,
    updatedAt: Date.now(),
  });
}

// Applies a refund outcome to a pending (or needs_attention — its Stripe
// outcome is exactly what is unknown, so any report settles it) refund row
// and its order. Shared by the executor's result write, the owner's status
// check and webhook reconciliation; rows already settled are left alone,
// with one exception: reconciliation may flip a "failed" row to succeeded
// (recoverFailed), because a refund.updated success is Stripe's proof the
// money moved and outranks whatever local error settled the row.
async function applyRefundOutcome(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  outcome: "succeeded" | "failed",
  opts?: {
    stripeRefundId?: string;
    // The rejection that settled the row (a definitive Stripe refusal);
    // written in the same patch as the status so the row is updated once.
    lastError?: string;
    recoverFailed?: boolean;
  },
) {
  const applies =
    refund.status === "pending" ||
    refund.status === "needs_attention" ||
    (opts?.recoverFailed === true &&
      refund.status === "failed" &&
      outcome === "succeeded");
  if (!applies) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(refund._id, {
    status: outcome,
    stripeRefundId: opts?.stripeRefundId ?? refund.stripeRefundId,
    ...(opts?.lastError !== undefined ? { lastError: opts.lastError } : {}),
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
      await patchOrder(ctx, order, {
        status:
          returnedCents >= order.amountBreakdown.totalCents
            ? "refunded"
            : "partially_refunded",
        updatedAt: now,
      });
    }
    return;
  }

  await logRefundAudit(ctx, refund, {
    type: "refund_failed",
    amountCents: refund.amountCents,
  });
}

// The result write for a refund Stripe reports holding for the row — the
// one the executor just created, or the one a status check found.
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
    // Why a "failed" outcome failed (Stripe's failure reason, or the local
    // error), kept on the row as its lastError.
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund) {
      return null;
    }
    if (args.outcome === "pending") {
      if (args.stripeRefundId) {
        await recordRefundInFlight(ctx, refund, args.stripeRefundId);
      }
      return null;
    }
    await applyRefundOutcome(ctx, refund, args.outcome, {
      stripeRefundId: args.stripeRefundId,
      lastError: args.outcome === "failed" ? args.errorMessage : undefined,
    });
    return null;
  },
});

// Reconciliation from Stripe's refund lifecycle events: recovers a pending
// row whose executor crashed between the Stripe call and the result write,
// a "failed" row Stripe reports succeeded (the executor's error was wrong
// about the money), and a parked (needs_attention) row whose refund Stripe
// reports it holds — processing or settled — which the attempts never
// learned of. A succeeded row stays succeeded (a post-success flip is rare
// enough to be a support case, not an automated rewrite), and refunds
// issued outside the app (dashboard) have no row and are ignored.
export const handleRefundEvent = internalMutation({
  args: {
    stripeEventId: v.string(),
    stripeRefundId: v.string(),
    refundStatus: v.string(),
    // The paymentRefunds row id from the refund's metadata: the fallback
    // lookup for a row whose executor crashed before recording the Stripe
    // refund id.
    refundRowId: v.union(v.string(), v.null()),
    // The refund's amount as Stripe reports it. A refund that names a row
    // (by id or metadata) but returns a different amount is not that row's
    // refund — a replacement an operator stamped with the wrong row, say —
    // and must not settle it.
    amountCents: v.optional(v.number()),
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
    if (
      args.amountCents !== undefined &&
      args.amountCents !== refund.amountCents
    ) {
      console.error(
        `Ignoring refund ${args.stripeRefundId}: amount ${args.amountCents} disagrees with row ${refund._id} (${refund.amountCents})`,
      );
      return null;
    }
    if (args.refundStatus === "succeeded") {
      await applyRefundOutcome(ctx, refund, "succeeded", {
        stripeRefundId: args.stripeRefundId,
        recoverFailed: true,
      });
    } else if (
      args.refundStatus === "failed" ||
      args.refundStatus === "canceled"
    ) {
      await applyRefundOutcome(ctx, refund, "failed", {
        stripeRefundId: args.stripeRefundId,
      });
    } else if (
      args.refundStatus === "pending" ||
      args.refundStatus === "requires_action"
    ) {
      await recordRefundInFlight(ctx, refund, args.stripeRefundId);
    }
    return null;
  },
});

// What the row looks like to a status check: resolved behind the payments
// permission on the owning organization, so no caller learns a refund's
// state (or spends a Stripe call on it) without the right to.
export const refundForStatusCheck = internalQuery({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund) {
      throw new Error("Refund not found");
    }
    await requireOwnerPaymentsPermission(ctx, parseMoneyRowOwner(refund));
    const order = await ctx.db.get(refund.orderId);
    return {
      status: refund.status,
      stripeChargeId: refund.stripeChargeId ?? order?.stripeChargeId ?? null,
      amountCents: refund.amountCents,
    };
  },
});

// What one status check established. "settled" and "processing" mean the
// row now reflects Stripe's record; the other three leave the row exactly
// as it was.
export type RefundStatusCheck =
  | { result: "settled"; status: "succeeded" | "failed" }
  | { result: "processing" }
  // Stripe holds no refund stamped with this row: the request never
  // landed, or it landed without the row's stamp (docs/refund-recovery.md).
  | { result: "unresolved" }
  // Stripe holds a refund stamped with this row whose amount is not the
  // row's: not this row's refund, and not something to settle from.
  | { result: "mismatch"; stripeRefundId: string; amountCents: number }
  | { result: "check_failed"; message: string };

// The owner's one recovery verb for a refund whose outcome is unknown:
// asks Stripe for the refund stamped with the row (the charge's refunds,
// matched on the row id in their metadata) and settles the row from that
// record through the same mutation the executor uses. A pending row may
// be checked too — an operator confirming an attempt landed — but a
// settled row is reported as it stands without a Stripe call. The check
// never creates a refund, never reschedules the executor, and never
// resets the row's attempt count or error: finding nothing is reported
// as nothing, not as failure.
export const checkRefundStatus = action({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args): Promise<RefundStatusCheck> => {
    const refund: {
      status: Doc<"paymentRefunds">["status"];
      stripeChargeId: string | null;
      amountCents: number;
    } = await ctx.runQuery(internal.payments.refunds.refundForStatusCheck, {
      refundId: args.refundId,
    });
    if (refund.status === "succeeded" || refund.status === "failed") {
      return { result: "settled", status: refund.status };
    }
    if (!refund.stripeChargeId) {
      return { result: "unresolved" };
    }
    let found: Awaited<ReturnType<StripeGateway["findRefundForRow"]>>;
    try {
      found = await getStripeGateway(requireStripeSecretKey()).findRefundForRow(
        { chargeId: refund.stripeChargeId, refundRowId: args.refundId },
      );
    } catch (error) {
      console.error(`Refund status check failed for ${args.refundId}`, error);
      return { result: "check_failed", message: errorMessageOf(error) };
    }
    if (!found) {
      return { result: "unresolved" };
    }
    if (found.amountCents !== refund.amountCents) {
      return {
        result: "mismatch",
        stripeRefundId: found.stripeRefundId,
        amountCents: found.amountCents,
      };
    }
    const outcome = refundOutcomeFromStatus(found.status);
    await (ctx.runMutation(internal.payments.refunds.markRefundResult, {
      refundId: args.refundId,
      outcome,
      stripeRefundId: found.stripeRefundId,
      errorMessage:
        outcome === "failed"
          ? (found.failureReason ?? "Stripe reports this refund failed")
          : undefined,
    }) satisfies Promise<null>);
    return outcome === "pending"
      ? { result: "processing" }
      : { result: "settled", status: outcome };
  },
});

// Refunds whose outcome is unknown, for the organizer's payout card (the
// read is model/payments.ts refundsNeedingAttention): each one blocks the
// event's payout until Stripe's record settles it — the owner's
// checkRefundStatus, or the refund.updated webhook. Any organizer of the
// event can see them; checking is gated separately on the payments
// permission.
export const listRefundsNeedingAttention = query({
  args: moneyRowOwnerArgs,
  handler: async (ctx, args) => {
    const owner = parseMoneyRowOwner(args);
    if (owner.kind === "convention") {
      await requireConventionOrganizerAccess(ctx, owner.conventionId);
    } else {
      await requireOrganizerAccess(ctx, owner.tournamentId);
    }
    return await refundsNeedingAttention(ctx, owner);
  },
});
