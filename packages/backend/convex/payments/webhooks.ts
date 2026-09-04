import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { logEntryPaymentAudit } from "../model/auditLog";
import {
  confirmPaidEntry,
  isEntrySeatable,
  paidEventForOrder,
  registrationForOrder,
  withdrawPendingEntry,
} from "../model/paidEvents";
import { isOpenOrderStatus } from "../model/payments";
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

// Resolves the order a session event targets, or null when the event does
// not match: an unknown/foreign order id, or a session this order no longer
// owns. Checkout (payments/checkout.ts) proves a session dead — expired, and
// never paid — before replacing it, and never leaves an unattached session
// payable, so a mismatched session id should always be a dead session's late
// event; handleCheckoutCompleted still refunds rather than trusts that.
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

// The invariant-violation backstop: a successful charge on a session the
// order no longer recognizes. The player was never seated for it and the
// order's own payment (if any) rode a different charge, so the stray charge
// is refunded directly — queueRefund's chargeId override keeps the order's
// status out of it.
async function refundStrayCharge(
  ctx: MutationCtx,
  args: { orderId: string; sessionId: string; stripeChargeId: string | null },
) {
  if (!args.stripeChargeId) {
    return;
  }
  const orderId = ctx.db.normalizeId("paymentOrders", args.orderId);
  const order = orderId ? await ctx.db.get(orderId) : null;
  if (!order || order.stripeCheckoutSessionId === args.sessionId) {
    return;
  }
  // Both completion events for one session (completed + async success), or a
  // replayed delivery under a new event id, must not refund twice.
  const existing = (
    await ctx.db
      .query("paymentRefunds")
      .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
      .take(64)
  ).find((refund) => refund.stripeChargeId === args.stripeChargeId);
  if (existing) {
    return;
  }
  const registration = await ctx.db.get(order.registrationId);
  if (!registration) {
    return;
  }
  await queueRefund(ctx, {
    order,
    registration,
    kind: "full",
    reason: "seat_unavailable",
    absorbedFeeCents: 0,
    // Every session for an order is minted from its frozen breakdown, so the
    // stray charge's amount is the order total.
    amountCentsOverride: order.amountBreakdown.totalCents,
    stripeChargeId: args.stripeChargeId,
  });
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
      // Checkout's supersede proof should make a paid mismatched session
      // impossible — but a successful charge is never silently discarded on
      // that argument. If the money is real, refund it (without touching the
      // order: its own payment lives on a different session).
      await refundStrayCharge(ctx, args);
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
    if (!isOpenOrderStatus(order.status) && !lateSuccess) {
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

    const entry = await registrationForOrder(ctx, order);
    const owner = await paidEventForOrder(ctx, order);
    if (!entry || !owner) {
      return null;
    }

    await logEntryPaymentAudit(ctx, {
      owner: order,
      registration: entry.registration,
      actorRole: "system",
      event: {
        type: "payment_completed",
        totalCents: order.amountBreakdown.totalCents,
      },
    });

    // The seat decision, made at payment time: the pre-checkout capacity
    // check is not a hold, so two payers can race past it and the loser is
    // made whole here instead of overfilling the field (a badge's ticket
    // type selling out counts the same as the whole convention).
    if (!lateSuccess && (await isEntrySeatable(ctx, owner, entry))) {
      const payer = await ctx.db.get(order.userId);
      await confirmPaidEntry(ctx, { owner, entry, payer, now });
      return null;
    }

    // Only a live attempt's refusal settles the entry. On a late success the
    // order was already closed and whatever closed it settled the entry then;
    // a row pending NOW belongs to a newer checkout (a cancel-and-retry, a
    // re-approval) that this stale payment must not withdraw.
    if (!lateSuccess) {
      await withdrawPendingEntry(ctx, entry, now);
    }
    await queueRefund(ctx, {
      order: paidOrder,
      registration: entry.registration,
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
  const entry = await registrationForOrder(ctx, order);
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
    if (entry) {
      await withdrawPendingEntry(ctx, entry, now);
    }
  }

  if (entry) {
    await logEntryPaymentAudit(ctx, {
      owner: order,
      registration: entry.registration,
      actorRole: "system",
      event: { type: args.auditType },
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
    const entry = await registrationForOrder(ctx, order);
    if (entry) {
      await logEntryPaymentAudit(ctx, {
        owner: order,
        registration: entry.registration,
        actorRole: "system",
        event: { type: "order_disputed" },
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
