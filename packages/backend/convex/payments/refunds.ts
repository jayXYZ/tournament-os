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
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import {
  hasPriorPlayerCancelFullRefund,
  ordersForRegistration,
  refundWindowOpen,
} from "../model/payments";
import { getStripeGateway } from "../stripe/client";
import { requireStripeSecretKey } from "../stripe/config";

// Refund execution. A refund is queued as a pending paymentRefunds row inside
// whatever mutation decided it (webhook race, player cancel, organizer
// removal, cancellation sweep), then a scheduled action performs the single
// Stripe call and a mutation records the outcome — so every state change
// stays transactional and the Stripe call is idempotent per refund row.

export async function queueRefund(
  ctx: Parameters<typeof logAuditEvent>[0],
  args: {
    order: Doc<"paymentOrders">;
    registration: Doc<"tournamentRegistrations">;
    kind: Doc<"paymentRefunds">["kind"];
    reason: Doc<"paymentRefunds">["reason"];
    // The processing-fee estimate deducted from the organizer's payout;
    // 0 when nobody attributable absorbs it (seat_unavailable, entry_only).
    absorbedFeeCents: number;
    initiatedBy?: { actor: Doc<"users">; actorRole: "player" | "organizer" };
  },
) {
  const amountCents = refundAmountCents(args.order.amountBreakdown, args.kind);
  const refundId = await ctx.db.insert("paymentRefunds", {
    orderId: args.order._id,
    tournamentId: args.order.tournamentId,
    registrationId: args.order.registrationId,
    participantId: args.order.participantId,
    kind: args.kind,
    reason: args.reason,
    amountCents,
    absorbedFeeCents: args.absorbedFeeCents,
    status: "pending",
    initiatedByUserId: args.initiatedBy?.actor._id,
    updatedAt: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: args.order.tournamentId,
    ...(args.initiatedBy ?? { actorRole: "system" as const }),
    event: {
      type: "refund_issued",
      player: auditPlayerRef(args.registration),
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

// Settles a registration's orders when its entry leaves the event pre-start
// (a player cancellation or an organizer rejection/removal — the roster
// verbs call this after the entry-state change). Open orders close and
// their sessions expire; a paid order refunds by whose decision the exit
// was: an organizer removal always refunds in full with the organizer
// absorbing the processing fee, while a player cancellation runs the refund
// window and the repeat-drop rule. Past the window the order simply stays
// paid and flows into the payout.
export async function settleOrdersOnEntryExit(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
    actor: Doc<"users">;
    actorRole: AuditActorRole;
  },
) {
  const orders = await ordersForRegistration(ctx, args.registration._id);
  for (const order of orders) {
    if (
      order.status === "requires_payment" ||
      order.status === "awaiting_payment"
    ) {
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
      continue;
    }
    if (order.status !== "paid") {
      continue;
    }

    if (args.actorRole === "player") {
      if (!refundWindowOpen(args.tournament, Date.now())) {
        continue;
      }
      const repeatDrop = await hasPriorPlayerCancelFullRefund(
        ctx,
        args.tournament._id,
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

export const beginRefundExecution = internalMutation({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.status !== "pending") {
      return null;
    }
    const order = await ctx.db.get(refund.orderId);
    if (!order?.stripeChargeId) {
      // A paid order always carries its charge id (the webhook records it
      // before any refund is queued); a missing one is unexecutable.
      await ctx.db.patch(args.refundId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      return null;
    }
    return {
      stripeChargeId: order.stripeChargeId,
      amountCents: refund.amountCents,
    };
  },
});

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
    try {
      const { stripeRefundId } = await gateway.createRefund({
        chargeId: begin.stripeChargeId,
        amountCents: begin.amountCents,
        refundRowId: args.refundId,
        idempotencyKey: `refund:${args.refundId}`,
      });
      await ctx.runMutation(internal.payments.refunds.markRefundResult, {
        refundId: args.refundId,
        outcome: "succeeded",
        stripeRefundId,
      });
    } catch (error) {
      await ctx.runMutation(internal.payments.refunds.markRefundResult, {
        refundId: args.refundId,
        outcome: "failed",
      });
      // Rethrown so the failure is visible in function logs; the refund row
      // and refund_failed audit line carry the user-facing record.
      throw error;
    }
    return null;
  },
});

// Applies a refund outcome to a pending refund row (and its order). Shared
// by the executor's result write and webhook reconciliation; rows already
// settled are left alone.
async function applyRefundOutcome(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
  outcome: "succeeded" | "failed",
  stripeRefundId?: string,
) {
  if (refund.status !== "pending") {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(refund._id, {
    status: outcome,
    stripeRefundId: stripeRefundId ?? refund.stripeRefundId,
    updatedAt: now,
  });

  if (outcome === "succeeded") {
    const order = await ctx.db.get(refund.orderId);
    if (order) {
      await ctx.db.patch(order._id, {
        status: refund.kind === "full" ? "refunded" : "partially_refunded",
        updatedAt: now,
      });
    }
    return;
  }

  const registration = await ctx.db.get(refund.registrationId);
  if (registration) {
    await logAuditEvent(ctx, {
      tournamentId: refund.tournamentId,
      actorRole: "system",
      event: {
        type: "refund_failed",
        player: auditPlayerRef(registration),
        amountCents: refund.amountCents,
      },
    });
  }
}

export const markRefundResult = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    outcome: v.union(v.literal("succeeded"), v.literal("failed")),
    stripeRefundId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund) {
      return null;
    }
    await applyRefundOutcome(ctx, refund, args.outcome, args.stripeRefundId);
    return null;
  },
});

// Reconciliation from Stripe's refund lifecycle events: recovers a pending
// row whose executor crashed between the Stripe call and the result write.
// Rows already settled stay settled (a post-settlement flip is rare enough
// to be a support case, not an automated rewrite), and refunds issued
// outside the app (dashboard) have no row and are ignored.
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
      await applyRefundOutcome(ctx, refund, "succeeded", args.stripeRefundId);
    } else if (
      args.refundStatus === "failed" ||
      args.refundStatus === "canceled"
    ) {
      await applyRefundOutcome(ctx, refund, "failed", args.stripeRefundId);
    }
    return null;
  },
});
