import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { feeConfigFromEnv } from "../stripe/config";
import { moneyRowOwnerColumns } from "./paidEventOwner";
import { stripeAccountForOrganization } from "./stripeAccounts";

// Paid-event domain rules. Everything money-shaped hangs off order records
// rather than registration state (TODO.md §9: never overload registration
// status).
//
// Two kinds of event sell entries: tournaments (entry fees, priced by the
// document's entryFeeCents — its presence is what makes a tournament paid)
// and conventions (badge fees, priced per ticket type — ADR 0004,
// model/ticketTypes.ts). The documents deliberately share the
// lifecycle/capacity field names (see the conventions table in schema.ts),
// so most rules here are structural over either doc; where a database index
// or a price source must be chosen, the discriminated PaidEventRef picks
// it.

// The discriminated owner of a paid entry — the one seam type the payment
// engine branches on. `event` carries the full doc so structural rules
// (fees, capacity, refund window) read it directly.
export type PaidEventRef =
  | { kind: "tournament"; event: Doc<"tournaments"> }
  | { kind: "convention"; event: Doc<"conventions"> };

// Either kind of entry row an order can pay for.
export type AnyEntryRegistration =
  | Doc<"tournamentRegistrations">
  | Doc<"conventionRegistrations">;

export type AnyEntryRegistrationId =
  | Id<"tournamentRegistrations">
  | Id<"conventionRegistrations">;

// The owner-pair columns stamped onto money rows: exactly one id set,
// matching the registrationId's table. Reads go back through the parsers in
// model/paidEventOwner.ts.
export function paidEventOwnerColumns(ref: PaidEventRef) {
  return moneyRowOwnerColumns(
    ref.kind === "tournament"
      ? { kind: "tournament", tournamentId: ref.event._id }
      : { kind: "convention", conventionId: ref.event._id },
  );
}

// Tournaments only — a convention's paid-ness lives on its ticket types
// (model/ticketTypes.ts isPaidTicketType).
export function isPaidEvent(event: { entryFeeCents?: number }) {
  return (event.entryFeeCents ?? 0) > 0;
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
  registrationId: AnyEntryRegistrationId,
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
  registrationId: AnyEntryRegistrationId,
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
  registrationId: AnyEntryRegistrationId,
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
  registrationId: AnyEntryRegistrationId,
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

// Whether a player cancellation still earns the automatic refund
// (tournaments). The default window is "until the event starts" —
// cancellation itself only exists during the registration lifecycle — so
// only an organizer-set earlier deadline narrows it.
export function refundWindowOpen(
  event: { refundDeadline?: number },
  now: number,
) {
  return event.refundDeadline === undefined || now <= event.refundDeadline;
}

// The owner-aware refund window. Tournaments keep the lifecycle-implied
// default above; conventions anchor the default to their start date
// (refundDeadline ?? startDate, ADR 0004) — with "registration" spanning
// the whole live run, "refundable while cancellable" would let an attendee
// self-refund mid-convention.
export function paidEntryRefundWindowOpen(owner: PaidEventRef, now: number) {
  if (owner.kind === "convention") {
    return now <= (owner.event.refundDeadline ?? owner.event.startDate);
  }
  return refundWindowOpen(owner.event, now);
}

// The repeat-drop rule's memory: has this participant already taken an
// automatic full refund for their own cancellation of this event? Failed
// refunds don't count (the player never got the money); pending ones do
// (the decision stands even while Stripe processes it).
export async function hasPriorPlayerCancelFullRefund(
  ctx: QueryCtx,
  ref: PaidEventRef,
  participantId: Id<"participants">,
) {
  const refunds =
    ref.kind === "tournament"
      ? await ctx.db
          .query("paymentRefunds")
          .withIndex("by_tournamentId_and_participantId", (q) =>
            q
              .eq("tournamentId", ref.event._id)
              .eq("participantId", participantId),
          )
          .take(64)
      : await ctx.db
          .query("paymentRefunds")
          .withIndex("by_conventionId_and_participantId", (q) =>
            q
              .eq("conventionId", ref.event._id)
              .eq("participantId", participantId),
          )
          .take(64);
  return refunds.some(
    (refund) =>
      refund.reason === "player_cancel" &&
      refund.kind === "full" &&
      refund.status !== "failed",
  );
}

// The paid orders for an event in one status, read through the owner's index.
async function firstOrderWithStatus(
  ctx: QueryCtx,
  ref: PaidEventRef,
  status: Doc<"paymentOrders">["status"],
) {
  return ref.kind === "tournament"
    ? await ctx.db
        .query("paymentOrders")
        .withIndex("by_tournamentId_and_status", (q) =>
          q.eq("tournamentId", ref.event._id).eq("status", status),
        )
        .first()
    : await ctx.db
        .query("paymentOrders")
        .withIndex("by_conventionId_and_status", (q) =>
          q.eq("conventionId", ref.event._id).eq("status", status),
        )
        .first();
}

// The hard-delete guard: an event that still holds player money cannot be
// deleted. Open or disputed orders and unsettled refunds always block; paid
// orders block unless the payout completed (the money reached the
// organization). Resolution: cancel the event (refunds everyone) or
// complete it (pays out), then delete.
export async function requireEventPaymentsSettled(
  ctx: QueryCtx,
  ref: PaidEventRef,
) {
  const blockedMessage =
    `This ${ref.kind} still holds player payments — cancel it (refunding ` +
    "players) or complete it (paying out) and let payments settle before " +
    "deleting";
  for (const status of [...OPEN_ORDER_STATUSES, "disputed"] as const) {
    if (await firstOrderWithStatus(ctx, ref, status)) {
      throw new Error(blockedMessage);
    }
  }
  const pendingRefund =
    ref.kind === "tournament"
      ? await ctx.db
          .query("paymentRefunds")
          .withIndex("by_tournamentId_and_status", (q) =>
            q.eq("tournamentId", ref.event._id).eq("status", "pending"),
          )
          .first()
      : await ctx.db
          .query("paymentRefunds")
          .withIndex("by_conventionId_and_status", (q) =>
            q.eq("conventionId", ref.event._id).eq("status", "pending"),
          )
          .first();
  if (pendingRefund) {
    throw new Error(blockedMessage);
  }
  const paidOrder = await firstOrderWithStatus(ctx, ref, "paid");
  if (paidOrder) {
    const payout =
      ref.kind === "tournament"
        ? await ctx.db
            .query("eventPayouts")
            .withIndex("by_tournamentId", (q) =>
              q.eq("tournamentId", ref.event._id),
            )
            .unique()
        : await ctx.db
            .query("eventPayouts")
            .withIndex("by_conventionId", (q) =>
              q.eq("conventionId", ref.event._id),
            )
            .unique();
    if (payout?.status !== "completed") {
      throw new Error(blockedMessage);
    }
  }
}

// The fee freeze (tournaments): once ANY order exists — terminal ones
// included — the entry fee is locked. Repricing would desync stored
// breakdowns from the configured fee, and even an expired or canceled order
// can still turn into money (an async payment completing late), so no order
// status is safe to reprice around. Convention pricing freezes per ticket
// type instead (model/ticketTypes.ts requireTicketTypePriceEditable).
export async function requireEntryFeeEditable(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  const order = await ctx.db
    .query("paymentOrders")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournament._id),
    )
    .first();
  if (order) {
    throw new Error(
      "Entry fee settings are locked once a payment exists for this event",
    );
  }
}

// What an order charges for, resolved by the caller from the owner's price
// source: a tournament's entryFeeCents, or the chosen ticket type's
// priceCents. The ticketTypeId travels with a convention price so the order
// can be stamped with it (the per-type freeze and delete guard read the
// stamp) — createEntryOrder enforces the pairing the same way the owner
// pair is enforced.
export type EntryOrderPricing =
  | { kind: "tournament"; entryFeeCents: number }
  | {
      kind: "convention";
      entryFeeCents: number;
      ticketTypeId: Id<"conventionTicketTypes">;
    };

// Inserts a fresh payable order for the registration, snapshotting the
// breakdown from the resolved price and the deployment's fee config. The
// payer must be the registration's linked account — paid entry is self-serve
// only, so a Guest registration cannot take an order.
export async function createEntryOrder(
  ctx: MutationCtx,
  args: {
    owner: PaidEventRef;
    registration: AnyEntryRegistration;
    purpose: Doc<"paymentOrders">["purpose"];
    pricing: EntryOrderPricing;
  },
) {
  if (args.pricing.kind !== args.owner.kind) {
    throw new Error("Order owner and pricing source disagree");
  }
  const entryFeeCents = args.pricing.entryFeeCents;
  if (entryFeeCents <= 0) {
    throw new Error("This event has no entry fee");
  }
  const participant = await ctx.db.get(args.registration.participantId);
  if (!participant?.userId) {
    throw new Error("Guest entries cannot pay an entry fee");
  }
  const now = Date.now();
  const orderId = await ctx.db.insert("paymentOrders", {
    ...paidEventOwnerColumns(args.owner),
    organizationId: args.owner.event.organizationId,
    registrationId: args.registration._id,
    participantId: args.registration.participantId,
    ticketTypeId:
      args.pricing.kind === "convention"
        ? args.pricing.ticketTypeId
        : undefined,
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
  return await createEntryOrder(ctx, {
    owner: { kind: "tournament", event: args.tournament },
    registration: args.registration,
    purpose: "post_approval",
    pricing: {
      kind: "tournament",
      entryFeeCents: args.tournament.entryFeeCents ?? 0,
    },
  });
}
