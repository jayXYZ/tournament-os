import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import { setRegistrationState } from "../model/participation";
import {
  adjustConfirmedRegistrationCount,
  hasCapacityAvailable,
} from "../model/registrations";
import { queueRefund } from "./refunds";

// Stripe webhook fulfillment (invoked from http.ts). Each handler performs
// its entire state change in one internalMutation and never calls Stripe;
// the http action does the one Stripe read (resolving the PaymentIntent's
// charge) before invoking it. Every handler is idempotent two ways: the
// processed-event table makes redeliveries exact no-ops, and status guards
// make out-of-order or superseded events harmless.

// True (and records the event) when this event id has not been processed
// yet; false when a redelivery should no-op.
async function recordFirstDelivery(
  ctx: MutationCtx,
  stripeEventId: string,
  type: string,
) {
  const existing = await ctx.db
    .query("stripeWebhookEvents")
    .withIndex("by_stripeEventId", (q) => q.eq("stripeEventId", stripeEventId))
    .unique();
  if (existing) {
    return false;
  }
  await ctx.db.insert("stripeWebhookEvents", {
    stripeEventId,
    type,
    processedAt: Date.now(),
  });
  return true;
}

// Resolves the order a session event targets, or null when the event should
// no-op: an unknown/foreign order id, or a session this order no longer
// owns. Sessions are expired before being replaced (payments/checkout.ts),
// so a mismatched session id is a superseded session's late event.
async function orderForSessionEvent(
  ctx: MutationCtx,
  rawOrderId: string,
  sessionId: string,
) {
  const orderId = ctx.db.normalizeId("paymentOrders", rawOrderId);
  if (!orderId) {
    return null;
  }
  const order = await ctx.db.get(orderId);
  if (!order) {
    return null;
  }
  if (
    order.stripeCheckoutSessionId !== undefined &&
    order.stripeCheckoutSessionId !== sessionId
  ) {
    return null;
  }
  return order;
}

export const handleCheckoutCompleted = internalMutation({
  args: {
    stripeEventId: v.string(),
    orderId: v.string(),
    sessionId: v.string(),
    stripePaymentIntentId: v.union(v.string(), v.null()),
    stripeChargeId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    if (
      !(await recordFirstDelivery(
        ctx,
        args.stripeEventId,
        "checkout.session.completed",
      ))
    ) {
      return null;
    }
    const order = await orderForSessionEvent(ctx, args.orderId, args.sessionId);
    if (!order) {
      return null;
    }
    // A payment can land on an order we already closed (the player cancelled
    // or the session "expired" while the async payment was in flight): the
    // money is real either way, so it is recorded as paid and immediately
    // refunded rather than seated.
    const lateSuccess =
      order.status === "canceled" ||
      order.status === "expired" ||
      order.status === "failed";
    if (
      order.status !== "requires_payment" &&
      order.status !== "awaiting_payment" &&
      !lateSuccess
    ) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(order._id, {
      status: "paid",
      stripeCheckoutSessionId: args.sessionId,
      stripePaymentIntentId: args.stripePaymentIntentId ?? undefined,
      stripeChargeId: args.stripeChargeId ?? undefined,
      paidAt: now,
      updatedAt: now,
    });
    const paidOrder = (await ctx.db.get(order._id))!;

    const registration = await ctx.db.get(order.registrationId);
    const tournament = await ctx.db.get(order.tournamentId);
    if (!registration || !tournament) {
      return null;
    }

    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actorRole: "system",
      event: {
        type: "payment_completed",
        player: auditPlayerRef(registration),
        totalCents: order.amountBreakdown.totalCents,
      },
    });

    // The seat decision, made at payment time: the pre-checkout capacity
    // check is not a hold, so two payers can race past it and the loser is
    // made whole here instead of overfilling the field.
    const seatable =
      !lateSuccess &&
      tournament.lifecycle === "registration" &&
      registration.entryStatus === "pending" &&
      hasCapacityAvailable(tournament);

    if (seatable) {
      await setRegistrationState(ctx, registration._id, {
        entryStatus: "confirmed",
        participationStatus: "active",
        tournamentStartDate: tournament.startDate,
        updatedAt: now,
      });
      await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
      const payer = await ctx.db.get(order.userId);
      await logAuditEvent(ctx, {
        tournamentId: tournament._id,
        ...(payer
          ? { actor: payer, actorRole: "player" as const }
          : { actorRole: "system" as const }),
        event: {
          type: "player_registered",
          player: auditPlayerRef(registration),
        },
      });
      return null;
    }

    if (registration.entryStatus === "pending") {
      await setRegistrationState(ctx, registration._id, {
        entryStatus: "cancelled",
        updatedAt: now,
      });
    }
    await queueRefund(ctx, {
      order: paidOrder,
      registration,
      kind: "full",
      reason: "seat_unavailable",
      absorbedFeeCents: 0,
    });
    return null;
  },
});

// Shared shape of the two "the session closed unpaid" events. A direct
// registration closes with its session; a post-approval order stays payable
// (the approval stands), dropping back to requires_payment with no session.
async function closeUnpaidSession(
  ctx: MutationCtx,
  args: {
    stripeEventId: string;
    eventType: string;
    orderId: string;
    sessionId: string;
    closedStatus: Extract<Doc<"paymentOrders">["status"], "expired" | "failed">;
    auditType: "payment_expired" | "payment_failed";
  },
) {
  if (!(await recordFirstDelivery(ctx, args.stripeEventId, args.eventType))) {
    return;
  }
  const order = await orderForSessionEvent(ctx, args.orderId, args.sessionId);
  if (!order || order.status !== "awaiting_payment") {
    return;
  }

  const now = Date.now();
  if (order.purpose === "post_approval") {
    await ctx.db.patch(order._id, {
      status: "requires_payment",
      stripeCheckoutSessionId: undefined,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(order._id, {
      status: args.closedStatus,
      updatedAt: now,
    });
    const registration = await ctx.db.get(order.registrationId);
    if (registration?.entryStatus === "pending") {
      await setRegistrationState(ctx, registration._id, {
        entryStatus: "cancelled",
        updatedAt: now,
      });
    }
  }

  const registration = await ctx.db.get(order.registrationId);
  if (registration) {
    await logAuditEvent(ctx, {
      tournamentId: order.tournamentId,
      actorRole: "system",
      event: {
        type: args.auditType,
        player: auditPlayerRef(registration),
      },
    });
  }
}

// v1 dispute policy: record-and-exclude. The order leaves "paid" so the
// payout enumeration never transfers a disputed charge; everything further
// (evidence, reversal, post-payout clawback) is a support workflow.
export const handleDisputeCreated = internalMutation({
  args: {
    stripeEventId: v.string(),
    stripeChargeId: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !(await recordFirstDelivery(
        ctx,
        args.stripeEventId,
        "charge.dispute.created",
      ))
    ) {
      return null;
    }
    const order = await ctx.db
      .query("paymentOrders")
      .withIndex("by_stripeChargeId", (q) =>
        q.eq("stripeChargeId", args.stripeChargeId),
      )
      .unique();
    if (!order || order.status === "disputed") {
      return null;
    }
    await ctx.db.patch(order._id, {
      status: "disputed",
      updatedAt: Date.now(),
    });
    const registration = await ctx.db.get(order.registrationId);
    if (registration) {
      await logAuditEvent(ctx, {
        tournamentId: order.tournamentId,
        actorRole: "system",
        event: {
          type: "order_disputed",
          player: auditPlayerRef(registration),
        },
      });
    }
    return null;
  },
});

export const handleCheckoutExpired = internalMutation({
  args: {
    stripeEventId: v.string(),
    orderId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await closeUnpaidSession(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: "checkout.session.expired",
      orderId: args.orderId,
      sessionId: args.sessionId,
      closedStatus: "expired",
      auditType: "payment_expired",
    });
    return null;
  },
});

export const handleAsyncPaymentFailed = internalMutation({
  args: {
    stripeEventId: v.string(),
    orderId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await closeUnpaidSession(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: "checkout.session.async_payment_failed",
      orderId: args.orderId,
      sessionId: args.sessionId,
      closedStatus: "failed",
      auditType: "payment_failed",
    });
    return null;
  },
});
