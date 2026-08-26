import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

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

// Order statuses that hold money or can still take it. While any exists for
// a tournament the entry fee is frozen (repricing would desync stored
// breakdowns from the configured fee) and the tournament refuses hard
// deletion.
export const LIVE_OR_MONEY_ORDER_STATUSES = [
  "requires_payment",
  "awaiting_payment",
  "paid",
  "refunded",
  "partially_refunded",
  "disputed",
] as const satisfies ReadonlyArray<Doc<"paymentOrders">["status"]>;

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

// The registration's payable order, if one is live: at most one order per
// registration is ever in a non-terminal status (begin reuses it and every
// closer runs through one mutation).
export async function openOrderForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const orders = await ordersForRegistration(ctx, registrationId);
  return (
    orders.find(
      (order) =>
        order.status === "requires_payment" ||
        order.status === "awaiting_payment",
    ) ?? null
  );
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

export async function requireEntryFeeEditable(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  for (const status of LIVE_OR_MONEY_ORDER_STATUSES) {
    const order = await ctx.db
      .query("paymentOrders")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", tournamentId).eq("status", status),
      )
      .first();
    if (order) {
      throw new Error(
        "Entry fee settings are locked once a payment exists for this event",
      );
    }
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
