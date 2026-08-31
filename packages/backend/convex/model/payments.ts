import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@paper-pairings/shared/payment-fees";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { feeConfigFromEnv } from "../stripe/config";
import { stripeAccountForOrganization } from "./stripeAccounts";

// Paid-event domain rules. The presence of entryFeeCents is what makes a
// tournament paid; everything money-shaped hangs off order records rather
// than registration state (TODO.md §9: never overload registration status).

export function isPaidTournament(tournament: Doc<"tournaments">) {
  return (tournament.entryFeeCents ?? 0) > 0;
}

export function requireValidEntryFee(entryFeeCents: number) {
  const message = validateEntryFeeCents(entryFeeCents);
  if (message) {
    throw new Error(message);
  }
  return entryFeeCents;
}

// Charging players is only allowed once the organization can actually be
// paid out, so a paid event can never strand funds on the platform behind an
// unfinished onboarding.
export async function requirePayoutsReadyOrganization(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const account = await stripeAccountForOrganization(ctx, organizationId);
  if (!account?.payoutsReady) {
    throw new Error(
      "Connect the organization's Stripe account before setting an entry fee",
    );
  }
  return account;
}

// Orders accumulate per registration (each expired/failed attempt leaves a
// terminal row behind, replaced by a fresh one); the rate limiter bounds the
// chain, this bounds the read.
export const MAX_ORDERS_PER_REGISTRATION = 64;

// The Stripe transfer_group tying an order's charge to its payout transfer.
// Derived, never stored — it is a pure function of the order id.
export function orderTransferGroup(orderId: Id<"paymentOrders">) {
  return `order:${orderId}`;
}

// The single definition of an "open" order: not yet paid and still able to
// take money. Every open/closed decision (reuse in begin, attach, webhook
// fulfillment, the close sweeps, the deletion guard) routes through these so
// a new status can never be classified inconsistently.
export const OPEN_ORDER_STATUSES = [
  "requires_payment",
  "awaiting_payment",
] as const satisfies ReadonlyArray<Doc<"paymentOrders">["status"]>;

export function isOpenOrderStatus(status: Doc<"paymentOrders">["status"]) {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
}

export async function ordersForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await ctx.db
    .query("paymentOrders")
    .withIndex("by_registrationId", (q) =>
      q.eq("registrationId", registrationId),
    )
    .order("desc")
    .take(MAX_ORDERS_PER_REGISTRATION);
}

// The registration's newest order — what payment surfaces display. One
// indexed single-document read, cheap enough for per-row roster shaping.
export async function latestOrderForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  return (
    await ctx.db
      .query("paymentOrders")
      .withIndex("by_registrationId", (q) =>
        q.eq("registrationId", registrationId),
      )
      .order("desc")
      .take(1)
  ).at(0);
}

// The registration's payable order, if one is live: at most one order per
// registration is ever in a non-terminal status (begin reuses it and every
// closer runs through one mutation).
export async function openOrderForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const orders = await ordersForRegistration(ctx, registrationId);
  return orders.find((order) => isOpenOrderStatus(order.status)) ?? null;
}

// Refund rows are bounded by orders (the rate limiter bounds those); this
// bounds the per-order refund read.
export const MAX_REFUNDS_PER_ORDER = 64;

// The order's refunds that are returning (or have returned) its own charge's
// money: failed rows returned nothing, and stray-charge rows returned a
// different charge's money. A pending row counts — the decision to return
// the money stands even while Stripe processes it — so callers use this to
// ask "is this order's money already spoken for?".
export async function refundsReturningForOrder(
  ctx: QueryCtx,
  orderId: Id<"paymentOrders">,
) {
  const refunds = await ctx.db
    .query("paymentRefunds")
    .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
    .take(MAX_REFUNDS_PER_ORDER);
  return refunds.filter(
    (refund) =>
      refund.status !== "failed" && refund.stripeChargeId === undefined,
  );
}

// Whether the registration's entry is still paid for: an order in "paid"
// status with no refund queued or settled against its charge. restoreEntry
// routes on this — a cancelled row whose money left (or is leaving) must go
// back through payment rather than retake a seat.
export async function registrationHoldsPaidOrder(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const orders = await ordersForRegistration(ctx, registrationId);
  for (const order of orders) {
    if (order.status !== "paid") {
      continue;
    }
    if ((await refundsReturningForOrder(ctx, order._id)).length === 0) {
      return true;
    }
  }
  return false;
}

// Whether a player cancellation still earns the automatic refund. The
// default window is "until the tournament starts" — cancellation itself only
// exists during the registration lifecycle — so only an organizer-set
// earlier deadline narrows it.
export function refundWindowOpen(tournament: Doc<"tournaments">, now: number) {
  return (
    tournament.refundDeadline === undefined || now <= tournament.refundDeadline
  );
}

// The repeat-drop rule's memory: has this participant already taken an
// automatic full refund for their own cancellation of this tournament?
// Failed refunds don't count (the player never got the money); pending ones
// do (the decision stands even while Stripe processes it).
export async function hasPriorPlayerCancelFullRefund(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  participantId: Id<"participants">,
) {
  const refunds = await ctx.db
    .query("paymentRefunds")
    .withIndex("by_tournamentId_and_participantId", (q) =>
      q.eq("tournamentId", tournamentId).eq("participantId", participantId),
    )
    .take(64);
  return refunds.some(
    (refund) =>
      refund.reason === "player_cancel" &&
      refund.kind === "full" &&
      refund.status !== "failed",
  );
}

// The hard-delete guard: a tournament that still holds player money cannot
// be deleted. Open or disputed orders and unsettled refunds always block;
// paid orders block unless the payout completed (the money reached the
// organization). Resolution: cancel the tournament (refunds everyone) or
// complete it (pays out), then delete.
export async function requireTournamentPaymentsSettled(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const blockedMessage =
    "This tournament still holds player payments — cancel it (refunding " +
    "players) or complete it (paying out) and let payments settle before " +
    "deleting";
  for (const status of [...OPEN_ORDER_STATUSES, "disputed"] as const) {
    const order = await ctx.db
      .query("paymentOrders")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", tournamentId).eq("status", status),
      )
      .first();
    if (order) {
      throw new Error(blockedMessage);
    }
  }
  const pendingRefund = await ctx.db
    .query("paymentRefunds")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId).eq("status", "pending"),
    )
    .first();
  if (pendingRefund) {
    throw new Error(blockedMessage);
  }
  const paidOrder = await ctx.db
    .query("paymentOrders")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId).eq("status", "paid"),
    )
    .first();
  if (paidOrder) {
    const payout = await ctx.db
      .query("tournamentPayouts")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .unique();
    if (payout?.status !== "completed") {
      throw new Error(blockedMessage);
    }
  }
}

// The fee freeze: once ANY order exists — terminal ones included — the entry
// fee is locked. Repricing would desync stored breakdowns from the
// configured fee, and even an expired or canceled order can still turn into
// money (an async payment completing late), so no order status is safe to
// reprice around.
export async function requireEntryFeeEditable(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const order = await ctx.db
    .query("paymentOrders")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .first();
  if (order) {
    throw new Error(
      "Entry fee settings are locked once a payment exists for this event",
    );
  }
}

// Inserts a fresh payable order for the registration, snapshotting the
// breakdown from the tournament's fee and the deployment's fee config. The
// payer must be the registration's linked account — paid entry is self-serve
// only, so a Guest registration cannot take an order.
export async function createEntryOrder(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
    purpose: Doc<"paymentOrders">["purpose"];
  },
) {
  const entryFeeCents = args.tournament.entryFeeCents ?? 0;
  if (entryFeeCents <= 0) {
    throw new Error("This event has no entry fee");
  }
  const participant = await ctx.db.get(args.registration.participantId);
  if (!participant?.userId) {
    throw new Error("Guest entries cannot pay an entry fee");
  }
  const now = Date.now();
  const orderId = await ctx.db.insert("paymentOrders", {
    tournamentId: args.tournament._id,
    organizationId: args.tournament.organizationId,
    registrationId: args.registration._id,
    participantId: args.registration.participantId,
    userId: participant.userId,
    purpose: args.purpose,
    amountBreakdown: computeOrderBreakdown(entryFeeCents, feeConfigFromEnv()),
    status: "requires_payment",
    updatedAt: now,
  });
  return (await ctx.db.get(orderId))!;
}

// The payable order approval requests on a paid event: reuses the
// registration's live order or inserts a post_approval one.
export async function ensurePostApprovalOrder(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
  },
) {
  const existing = await openOrderForRegistration(ctx, args.registration._id);
  if (existing) {
    return existing;
  }
  return await createEntryOrder(ctx, { ...args, purpose: "post_approval" });
}
