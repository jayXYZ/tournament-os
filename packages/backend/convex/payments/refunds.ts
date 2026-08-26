import { v } from "convex/values";

import { refundAmountCents } from "@tournament-os/shared/payment-fees";

import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction, internalMutation } from "../_generated/server";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
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

export const markRefundResult = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    outcome: v.union(v.literal("succeeded"), v.literal("failed")),
    stripeRefundId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const refund = await ctx.db.get(args.refundId);
    if (!refund || refund.status !== "pending") {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(args.refundId, {
      status: args.outcome,
      stripeRefundId: args.stripeRefundId,
      updatedAt: now,
    });

    if (args.outcome === "succeeded") {
      const order = await ctx.db.get(refund.orderId);
      if (order) {
        await ctx.db.patch(order._id, {
          status: refund.kind === "full" ? "refunded" : "partially_refunded",
          updatedAt: now,
        });
      }
      return null;
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
    return null;
  },
});
