import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireValidEntryFee } from "./payments";
import { cleanName } from "./tournaments";

// Ticket types (ADR 0004): the purchasable passes a convention sells. A
// type composes price, per-type capacity, an admission window, and comped
// child events — all the pass shapes ("day pass", "weekend pass", "VIP")
// are rows here, and this module owns their rules: the sale window with its
// admission-end default, the per-type price freeze, and the delete guard.

// Bounds every per-convention ticket-type read; the create verb enforces it.
export const MAX_TICKET_TYPES_PER_CONVENTION = 64;

// Bounds the comped-events array well under Convex's array cap.
export const MAX_INCLUDED_TOURNAMENTS_PER_TICKET_TYPE = 100;

export const DEFAULT_TICKET_TYPE_NAME = "General admission";

export async function listTicketTypes(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
) {
  return await ctx.db
    .query("conventionTicketTypes")
    .withIndex("by_conventionId_and_sortOrder", (q) =>
      q.eq("conventionId", conventionId),
    )
    .take(MAX_TICKET_TYPES_PER_CONVENTION);
}

export async function requireTicketType(
  ctx: QueryCtx,
  ticketTypeId: Id<"conventionTicketTypes">,
) {
  const ticketType = await ctx.db.get(ticketTypeId);
  if (!ticketType) {
    throw new Error("Ticket type not found");
  }
  return ticketType;
}

// The type a purchase names, verified to belong to the convention the
// caller is buying into — a foreign type id must never price this order.
export async function requireTicketTypeForConvention(
  ctx: QueryCtx,
  convention: Doc<"conventions">,
  ticketTypeId: Id<"conventionTicketTypes">,
) {
  const ticketType = await requireTicketType(ctx, ticketTypeId);
  if (ticketType.conventionId !== convention._id) {
    throw new Error("Ticket type belongs to a different convention");
  }
  return ticketType;
}

export function isPaidTicketType(ticketType: { priceCents: number }) {
  return ticketType.priceCents > 0;
}

// Whether any pass charges — the convention-level "is paid" question the
// lifecycle sweeps ask. Sound as an orders-exist proxy: the price freeze
// keeps a type that ever sold priced, and the delete guard keeps it alive,
// so orders can never outlive every paid type.
export async function conventionHasPaidTicketType(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
) {
  const ticketTypes = await listTicketTypes(ctx, conventionId);
  return ticketTypes.some(isPaidTicketType);
}

// The sale-end default (ADR 0004): an unset saleEndDate falls back to the
// admission end, then the convention's end — you must not be able to buy a
// day pass for a day already over.
export function effectiveSaleEnd(
  ticketType: Doc<"conventionTicketTypes">,
  convention: Doc<"conventions">,
) {
  return (
    ticketType.saleEndDate ?? ticketType.admissionEndDate ?? convention.endDate
  );
}

// Whether the type is purchasable right now: the convention's lifecycle is
// its whole live run ("registration", ADR 0004 — no in_progress phase), and
// the moment is inside the type's sale window. Checked at purchase begin
// (register / checkout); the webhook's seat decision re-checks lifecycle
// and capacity but deliberately not the window — an async payment begun in
// the window may seat after it closes.
export function isTicketTypeOnSale(
  convention: Doc<"conventions">,
  ticketType: Doc<"conventionTicketTypes">,
  now = Date.now(),
) {
  return (
    convention.lifecycle === "registration" &&
    (ticketType.saleStartDate === undefined ||
      now >= ticketType.saleStartDate) &&
    now <= effectiveSaleEnd(ticketType, convention)
  );
}

export function requireTicketTypeOnSale(
  convention: Doc<"conventions">,
  ticketType: Doc<"conventionTicketTypes">,
  now = Date.now(),
) {
  if (!isTicketTypeOnSale(convention, ticketType, now)) {
    throw new Error(`${ticketType.name} is not on sale`);
  }
}

// The per-type seat check, layered inside the convention's global capacity
// (callers check both; requireBadgeSeatAvailable below is the pair).
export function hasTicketTypeCapacity(ticketType: {
  capacity?: number;
  confirmedCount: number;
}) {
  return (
    ticketType.capacity === undefined ||
    ticketType.confirmedCount < ticketType.capacity
  );
}

export function requireTicketTypeCapacityAvailable(
  ticketType: Doc<"conventionTicketTypes">,
) {
  if (!hasTicketTypeCapacity(ticketType)) {
    throw new Error(`${ticketType.name} is sold out`);
  }
}

export async function adjustTicketTypeConfirmedCount(
  ctx: MutationCtx,
  ticketType: Doc<"conventionTicketTypes">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(ticketType._id, {
    confirmedCount: Math.max(0, ticketType.confirmedCount + delta),
    updatedAt: now,
  });
}

// The order-existence probe behind the price freeze, the delete guard, and
// the UI's priceLocked flag — one query so the three can never diverge on
// what counts as evidence (any order, terminal ones included).
export async function ticketTypeHasOrders(
  ctx: QueryCtx,
  ticketTypeId: Id<"conventionTicketTypes">,
) {
  const order = await ctx.db
    .query("paymentOrders")
    .withIndex("by_ticketTypeId", (q) => q.eq("ticketTypeId", ticketTypeId))
    .first();
  return order !== null;
}

// The per-type twin of the event-level fee freeze (model/payments.ts
// requireEntryFeeEditable): once ANY order references the type — terminal
// ones included — its price is locked, because stored breakdowns must never
// desync from the price they snapshotted and even a dead order can still
// turn into money (an async payment completing late).
export async function requireTicketTypePriceEditable(
  ctx: QueryCtx,
  ticketTypeId: Id<"conventionTicketTypes">,
) {
  if (await ticketTypeHasOrders(ctx, ticketTypeId)) {
    throw new Error(
      "Ticket price settings are locked once a payment exists for this ticket type",
    );
  }
}

// Hard-delete is allowed only while nothing references the type: no order
// (even a terminal one can still turn into money) and no badge row (a free
// badge creates no order, so orders alone cannot prove the type unused).
// A type that has sold ends its sale instead (saleEndDate in the past).
export async function requireTicketTypeDeletable(
  ctx: QueryCtx,
  ticketTypeId: Id<"conventionTicketTypes">,
) {
  const hasOrders = await ticketTypeHasOrders(ctx, ticketTypeId);
  const badge = hasOrders
    ? null
    : await ctx.db
        .query("conventionRegistrations")
        .withIndex("by_ticketTypeId", (q) => q.eq("ticketTypeId", ticketTypeId))
        .first();
  if (hasOrders || badge) {
    throw new Error(
      "This ticket type has registrations — end its sale instead of deleting it",
    );
  }
}

export type TicketTypeInputs = {
  name: string;
  description?: string;
  priceCents: number;
  capacity?: number;
  admissionStartDate?: number;
  admissionEndDate?: number;
  saleStartDate?: number;
  saleEndDate?: number;
};

// Validates a type's composable fields together against its convention:
// admission window inside the convention's dates, sale window ordered and
// never ending past the admission-end bound (the ADR's "no day passes for
// yesterday" rule), price either 0 (free) or a valid fee.
export function validTicketTypeInputs(
  convention: Doc<"conventions">,
  inputs: TicketTypeInputs,
): TicketTypeInputs {
  const name = cleanName(inputs.name, "Ticket name");
  if (inputs.priceCents !== 0) {
    requireValidEntryFee(inputs.priceCents);
  }
  const capacity =
    inputs.capacity === undefined ? undefined : Math.trunc(inputs.capacity);
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new Error("Ticket capacity must be a positive number");
  }
  for (const [label, value] of [
    ["admission start", inputs.admissionStartDate],
    ["admission end", inputs.admissionEndDate],
    ["sale start", inputs.saleStartDate],
    ["sale end", inputs.saleEndDate],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new Error(`Enter a valid ${label} date`);
    }
  }
  const admissionStart = inputs.admissionStartDate;
  const admissionEnd = inputs.admissionEndDate;
  if (
    admissionStart !== undefined &&
    (admissionStart < convention.startDate ||
      admissionStart > convention.endDate)
  ) {
    throw new Error("Admission must start within the convention's dates");
  }
  if (
    admissionEnd !== undefined &&
    (admissionEnd < convention.startDate || admissionEnd > convention.endDate)
  ) {
    throw new Error("Admission must end within the convention's dates");
  }
  if (
    admissionStart !== undefined &&
    admissionEnd !== undefined &&
    admissionEnd < admissionStart
  ) {
    throw new Error("Admission end must not be before its start");
  }
  const saleEndBound = admissionEnd ?? convention.endDate;
  if (inputs.saleEndDate !== undefined && inputs.saleEndDate > saleEndBound) {
    throw new Error(
      "Ticket sales must end by the time its admission window does",
    );
  }
  if (
    inputs.saleStartDate !== undefined &&
    inputs.saleStartDate > (inputs.saleEndDate ?? saleEndBound)
  ) {
    throw new Error("Ticket sales must start before they end");
  }
  return { ...inputs, name, capacity };
}

// The comped-events list, each id verified to be a child of this
// convention right now. Detaching a child later leaves a stale id behind;
// badgeCompsChildEvent re-checks membership at registration time, so a
// stale id is inert rather than a free pass into a foreign event.
export async function validIncludedTournamentIds(
  ctx: QueryCtx,
  convention: Doc<"conventions">,
  includedTournamentIds: Array<Id<"tournaments">>,
) {
  if (includedTournamentIds.length > MAX_INCLUDED_TOURNAMENTS_PER_TICKET_TYPE) {
    throw new Error(
      `A ticket type can include at most ${MAX_INCLUDED_TOURNAMENTS_PER_TICKET_TYPE} events`,
    );
  }
  const unique = [...new Set(includedTournamentIds)];
  const tournaments = await Promise.all(
    unique.map((tournamentId) => ctx.db.get(tournamentId)),
  );
  for (const tournament of tournaments) {
    if (!tournament || tournament.conventionId !== convention._id) {
      throw new Error("Included events must belong to this convention");
    }
  }
  return unique;
}

// Every convention starts with one free pass so the free-registration flow
// works out of the box; the organizer renames, prices, or replaces it.
export async function createDefaultTicketType(
  ctx: MutationCtx,
  conventionId: Id<"conventions">,
  now = Date.now(),
) {
  return await ctx.db.insert("conventionTicketTypes", {
    conventionId,
    name: DEFAULT_TICKET_TYPE_NAME,
    priceCents: 0,
    sortOrder: 0,
    confirmedCount: 0,
    includedTournamentIds: [],
    updatedAt: now,
  });
}
