import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { settleOrdersOnEntryExit } from "../payments/refunds";
import {
  currentUserOrNull,
  getActiveMembership,
  requireActiveMembership,
} from "./access";
import type { AuditActorRole } from "./auditLog";
import { conventionAuditPlayerRef, logConventionAuditEvent } from "./auditLog";
import { ensureParticipantForUser, participantForUser } from "./participants";
import { nextPublicCode } from "./publicCodes";
import { hasCapacityAvailable, playerDisplayName } from "./registrations";
import {
  adjustTicketTypeConfirmedCount,
  createDefaultTicketType,
  isPaidTicketType,
  requireTicketTypeCapacityAvailable,
  requireTicketTypeOnSale,
} from "./ticketTypes";
import { cleanName, validStartDate } from "./tournaments";

// The convention entity module (CONTEXT.md "Convention"): a first-class
// umbrella event that holds child tournaments and sells its own
// registrations — badges. It mirrors model/tournaments.ts for the entity
// itself and owns everything badge- and hierarchy-shaped: the badge verbs
// (a badge has no competitive state, so the roster machinery does not
// apply), the child-event gate, and the attach/detach rules.

export const CONVENTION_PUBLIC_CODE_COUNTER_KEY = "conventionPublicCode";
export const FIRST_CONVENTION_PUBLIC_CODE = 100_001;

// Badge capacity ceiling. Deliberately independent of
// MAX_TOURNAMENT_PLAYERS: that constant bounds per-tournament `.take()`s on
// competitive reads, while badge rosters are always paginated, so a
// convention can be much larger than any single event it hosts.
export const MAX_CONVENTION_ATTENDEES = 10_000;

export async function nextConventionPublicCode(
  ctx: MutationCtx,
  now = Date.now(),
) {
  return await nextPublicCode(
    ctx,
    CONVENTION_PUBLIC_CODE_COUNTER_KEY,
    FIRST_CONVENTION_PUBLIC_CODE,
    now,
  );
}

export type ConventionAccess = {
  convention: Doc<"conventions">;
  user: Doc<"users">;
  membership: Doc<"organizationMemberships">;
};

export async function requireConvention(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
) {
  const convention = await ctx.db.get(conventionId);
  if (!convention) {
    throw new Error("Convention not found");
  }
  return convention;
}

export async function requireConventionOrganizerAccess(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
): Promise<ConventionAccess> {
  const convention = await requireConvention(ctx, conventionId);
  const { user, membership } = await requireActiveMembership(
    ctx,
    convention.organizationId,
  );
  return { convention, user, membership };
}

// "registration" is the convention's whole live run (ADR 0004 — there is
// no in_progress phase): publish opens it, complete/cancel end it. Whether
// a specific pass can be bought right now is its ticket type's sale window
// (model/ticketTypes.ts isTicketTypeOnSale), layered inside this.
export function isConventionRegistrationOpen(convention: Doc<"conventions">) {
  return convention.lifecycle === "registration";
}

// Same rule as tournaments: published and not private. Unlisted conventions
// are reachable by code but never listed.
export function isConventionPubliclyViewable(convention: Doc<"conventions">) {
  return (
    convention.visibility !== "private" && convention.lifecycle !== "setup"
  );
}

// Whether the caller may see the convention at all — the public page's
// access rule, shared by every public read hanging off it (ticket types
// included, ADR 0004: a hidden convention exposes no types, prices, or
// availability). A non-public convention resolves only for the organizing
// team and badge holders — any badge row, so cancelling never swaps the
// page for "not found".
export async function canViewConvention(
  ctx: QueryCtx,
  convention: Doc<"conventions">,
) {
  if (isConventionPubliclyViewable(convention)) {
    return true;
  }
  const user = await currentUserOrNull(ctx);
  if (!user) {
    return false;
  }
  const membership = await getActiveMembership(
    ctx,
    convention.organizationId,
    user._id,
  );
  if (membership) {
    return true;
  }
  if (convention.lifecycle === "setup") {
    return false;
  }
  const badge = await badgeForUser(ctx, convention._id, user._id);
  return badge !== null;
}

export function requireConventionSetupEditable(convention: Doc<"conventions">) {
  if (convention.lifecycle !== "setup") {
    throw new Error("Convention setup is locked after publication");
  }
}

// Setup fields (dates, capacity, the badge gate, ticket types) stay
// editable for the convention's whole live run — with no in_progress phase
// there is no "underway" cutoff — and lock only once it completes or
// cancels.
export function requireConventionEditable(convention: Doc<"conventions">) {
  if (
    convention.lifecycle !== "setup" &&
    convention.lifecycle !== "registration"
  ) {
    throw new Error("Convention settings are locked once it is over");
  }
}

export function validConventionCapacity(value: number) {
  const capacity = Math.trunc(value);
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > MAX_CONVENTION_ATTENDEES
  ) {
    throw new Error(
      `Badge capacity must be between 1 and ${MAX_CONVENTION_ATTENDEES}`,
    );
  }
  return capacity;
}

// A convention spans a range; the end must not precede the start. Both ends
// run through validStartDate's finiteness check (the same NaN/Infinity hole
// it documents).
export function validDateRange(startDate: number, endDate: number) {
  const start = validStartDate(startDate);
  const end = validStartDate(endDate);
  if (end < start) {
    throw new Error("Convention end date must not be before its start date");
  }
  return { startDate: start, endDate: end };
}

export async function createConvention(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    startDate: number;
    endDate: number;
    playerCapacity: number;
    isTestEvent: boolean;
    visibility?: Doc<"conventions">["visibility"];
  },
) {
  const { user } = await requireActiveMembership(ctx, args.organizationId);
  const now = Date.now();
  const publicCode = await nextConventionPublicCode(ctx, now);
  const { startDate, endDate } = validDateRange(args.startDate, args.endDate);
  const conventionId = await ctx.db.insert("conventions", {
    name: cleanName(args.name, "Convention name"),
    publicCode,
    organizationId: args.organizationId,
    createdBy: user._id,
    visibility: args.visibility ?? "public",
    lifecycle: "setup",
    startDate,
    endDate,
    playerCapacity: validConventionCapacity(args.playerCapacity),
    isTestEvent: args.isTestEvent,
    badgeRequiredForChildEvents: false,
    confirmedRegistrationCount: 0,
    updatedAt: now,
  });
  // Seeded free pass (ADR 0004): the free-registration flow works out of
  // the box; the organizer renames, prices, or replaces it.
  await createDefaultTicketType(ctx, conventionId, now);
  return conventionId;
}

export async function adjustConventionConfirmedCount(
  ctx: MutationCtx,
  convention: Doc<"conventions">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(convention._id, {
    confirmedRegistrationCount: Math.max(
      0,
      convention.confirmedRegistrationCount + delta,
    ),
    updatedAt: now,
  });
}

export function requireBadgeCapacityAvailable(convention: Doc<"conventions">) {
  if (!hasCapacityAvailable(convention)) {
    throw new Error("Convention badges are sold out");
  }
}

export async function badgeForParticipant(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
  participantId: Id<"participants">,
) {
  return await ctx.db
    .query("conventionRegistrations")
    .withIndex("by_conventionId_and_participantId", (q) =>
      q.eq("conventionId", conventionId).eq("participantId", participantId),
    )
    .unique();
}

// The account holder's badge for a convention, resolved through their
// participant identity (same shape as registrationForUser, ADR 0002).
export async function badgeForUser(
  ctx: QueryCtx,
  conventionId: Id<"conventions">,
  userId: Id<"users">,
) {
  const participant = await participantForUser(ctx, userId);
  if (!participant) {
    return null;
  }
  return await badgeForParticipant(ctx, conventionId, participant._id);
}

export async function requireBadge(
  ctx: QueryCtx,
  badgeId: Id<"conventionRegistrations">,
) {
  const badge = await ctx.db.get(badgeId);
  if (!badge) {
    throw new Error("Badge registration not found");
  }
  return badge;
}

// The one badge writer. Badges have no competitive state, so unlike
// setRegistrationState there is no standings write-through to keep in step —
// this exists so every transition still funnels through one place.
export async function setBadgeEntryStatus(
  ctx: MutationCtx,
  badgeId: Id<"conventionRegistrations">,
  patch: {
    entryStatus: Doc<"conventionRegistrations">["entryStatus"];
    // A revived row may switch passes (upsertBadgeRow re-stamps it).
    ticketTypeId?: Id<"conventionTicketTypes">;
    playerName?: string;
    updatedAt: number;
  },
) {
  await ctx.db.patch(badgeId, patch);
}

// Why an existing badge row blocks a fresh registration or checkout, or null
// when it doesn't (a cancelled row is the reusable state, mirroring
// tournament registrations). v1 badge flows never write waitlisted/rejected,
// but the shared validator admits them, so both refuse honestly.
export function badgeBlocksRegistration(
  entryStatus: Doc<"conventionRegistrations">["entryStatus"],
): string | null {
  switch (entryStatus) {
    case "confirmed":
      return "Already registered for this convention";
    case "pending":
      return "Your badge checkout is already in progress";
    case "waitlisted":
      return "You are on the waitlist for this convention";
    case "rejected":
      return "Your convention registration was declined";
    case "cancelled":
      return null;
    default:
      throw new Error(
        `Unhandled badge entry status: ${entryStatus satisfies never}`,
      );
  }
}

// Files (or revives) the participant's badge row in the given status and
// ticket type, enforcing the one-badge-per-participant invariant through
// the uniqueness index. Shared by the free registration verb and the paid
// checkout begin; a revived row re-stamps the (possibly different) type.
export async function upsertBadgeRow(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    ticketType: Doc<"conventionTicketTypes">;
    user: Doc<"users">;
    entryStatus: "pending" | "confirmed";
  },
) {
  const now = Date.now();
  const participant = await ensureParticipantForUser(ctx, args.user._id);
  const existing = await badgeForParticipant(
    ctx,
    args.convention._id,
    participant._id,
  );
  if (existing) {
    const blockedBecause = badgeBlocksRegistration(existing.entryStatus);
    if (blockedBecause !== null) {
      throw new Error(blockedBecause);
    }
    await setBadgeEntryStatus(ctx, existing._id, {
      ticketTypeId: args.ticketType._id,
      entryStatus: args.entryStatus,
      playerName: playerDisplayName(args.user),
      updatedAt: now,
    });
    return (await ctx.db.get(existing._id))!;
  }
  const badgeId = await ctx.db.insert("conventionRegistrations", {
    conventionId: args.convention._id,
    participantId: participant._id,
    ticketTypeId: args.ticketType._id,
    entryStatus: args.entryStatus,
    playerName: playerDisplayName(args.user),
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(badgeId))!;
}

// The free-registration verb: takes the badge directly (no approval flow
// for badges in v1) for a free ticket type on sale. Paid types route
// through the checkout instead — the adapter refuses before calling this.
export async function registerBadge(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    ticketType: Doc<"conventionTicketTypes">;
    user: Doc<"users">;
  },
) {
  if (isPaidTicketType(args.ticketType)) {
    throw new Error("This ticket has a fee — pay through checkout");
  }
  requireTicketTypeOnSale(args.convention, args.ticketType);
  requireBadgeCapacityAvailable(args.convention);
  requireTicketTypeCapacityAvailable(args.ticketType);
  const badge = await upsertBadgeRow(ctx, {
    convention: args.convention,
    ticketType: args.ticketType,
    user: args.user,
    entryStatus: "confirmed",
  });
  await adjustConventionConfirmedCount(ctx, args.convention, 1);
  await adjustTicketTypeConfirmedCount(ctx, args.ticketType, 1);
  await logConventionAuditEvent(ctx, {
    conventionId: args.convention._id,
    actor: args.user,
    actorRole: "player",
    event: {
      type: "badge_registered",
      player: conventionAuditPlayerRef(badge),
    },
  });
  return badge;
}

// A badge exit shared by the player's own cancellation and the organizer's
// removal: the entry lands in "cancelled" (the reusable state), a confirmed
// badge releases its capacity, and money follows the entry out — open orders
// close and a paid one refunds by whose decision the exit was
// (payments/refunds.ts).
async function exitBadge(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    badge: Doc<"conventionRegistrations">;
    actor: Doc<"users">;
    actorRole: Exclude<AuditActorRole, "system">;
    auditType: "badge_cancelled" | "badge_removed";
  },
) {
  const now = Date.now();
  const heldSeat = args.badge.entryStatus === "confirmed";
  await setBadgeEntryStatus(ctx, args.badge._id, {
    entryStatus: "cancelled",
    updatedAt: now,
  });
  if (heldSeat) {
    await adjustConventionConfirmedCount(ctx, args.convention, -1, now);
    // A confirmed badge held a seat in its type's capacity too.
    const ticketType = await ctx.db.get(args.badge.ticketTypeId);
    if (ticketType) {
      await adjustTicketTypeConfirmedCount(ctx, ticketType, -1, now);
    }
  }
  await logConventionAuditEvent(ctx, {
    conventionId: args.convention._id,
    actor: args.actor,
    actorRole: args.actorRole,
    event: {
      type: args.auditType,
      player: conventionAuditPlayerRef(args.badge),
    },
  });
  await settleOrdersOnEntryExit(ctx, {
    owner: { kind: "convention", event: args.convention },
    registration: args.badge,
    actor: args.actor,
    actorRole: args.actorRole,
  });
}

// The player withdraws their own badge. Allowed for the convention's whole
// live run ("registration", ADR 0004) — the automatic refund is what the
// window governs (refundDeadline ?? startDate, paidEntryRefundWindowOpen),
// so a mid-con cancellation frees the seat but returns nothing — and only a
// pending (checkout in flight) or confirmed badge has anything to cancel.
export async function cancelBadge(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    badge: Doc<"conventionRegistrations">;
    actor: Doc<"users">;
  },
) {
  if (!isConventionRegistrationOpen(args.convention)) {
    throw new Error("Convention registration is not open");
  }
  if (
    args.badge.entryStatus !== "confirmed" &&
    args.badge.entryStatus !== "pending"
  ) {
    throw new Error("No active convention registration found");
  }
  await exitBadge(ctx, {
    ...args,
    actorRole: "player",
    auditType: "badge_cancelled",
  });
}

// The organizer removes a badge holder. Allowed until the convention
// completes; always refunds in full with the organizer absorbing the
// processing fee (the same organizer-decision rule as tournament removals).
export async function removeBadge(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    badge: Doc<"conventionRegistrations">;
    actor: Doc<"users">;
  },
) {
  if (
    args.convention.lifecycle === "completed" ||
    args.convention.lifecycle === "cancelled"
  ) {
    throw new Error("Convention is already over");
  }
  if (
    args.badge.entryStatus !== "confirmed" &&
    args.badge.entryStatus !== "pending"
  ) {
    throw new Error("No active convention registration found");
  }
  await exitBadge(ctx, {
    ...args,
    actorRole: "organizer",
    auditType: "badge_removed",
  });
}

// The badge gate for child events (CONTEXT.md "Badge"): when the owning
// convention requires badges, self-serve registration for a child tournament
// needs a confirmed one whose pass admits the event's day (a day pass does
// not gate into an event outside its admission window). An admission gate
// only — cancelling a badge never revokes child registrations already made,
// and organizer verbs (approve, guest enroll) bypass this by simply not
// calling it. Called from the two self-serve entry points: registerSelf and
// beginEntryCheckout.
export async function requireBadgeForChildEvent(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  userId: Id<"users">,
) {
  if (tournament.conventionId === undefined) {
    return;
  }
  const convention = await ctx.db.get(tournament.conventionId);
  if (!convention || !convention.badgeRequiredForChildEvents) {
    return;
  }
  const badge = await badgeForUser(ctx, convention._id, userId);
  if (badge?.entryStatus !== "confirmed") {
    throw new Error(
      `This event requires a ${convention.name} badge — register for the convention first`,
    );
  }
  const ticketType = await ctx.db.get(badge.ticketTypeId);
  if (
    ticketType &&
    ((ticketType.admissionStartDate !== undefined &&
      tournament.startDate < ticketType.admissionStartDate) ||
      (ticketType.admissionEndDate !== undefined &&
        tournament.startDate > ticketType.admissionEndDate))
  ) {
    throw new Error(
      `Your ${ticketType.name} does not cover this event's date — upgrade your ${convention.name} badge first`,
    );
  }
}

// Whether the participant's confirmed badge comps this child tournament
// (ADR 0004): the pass's includedTournamentIds names it, and the event
// still belongs to the badge's convention (a detach leaves stale ids
// behind; re-checking membership here keeps them inert). registerSelf and
// the approval verbs read this to let a comped player into a paid event
// free — no order is ever created.
export async function participantBadgeCompsChildEvent(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  participantId: Id<"participants">,
) {
  if (tournament.conventionId === undefined) {
    return false;
  }
  const badge = await badgeForParticipant(
    ctx,
    tournament.conventionId,
    participantId,
  );
  if (badge?.entryStatus !== "confirmed") {
    return false;
  }
  const ticketType = await ctx.db.get(badge.ticketTypeId);
  return (
    ticketType !== null &&
    ticketType.conventionId === tournament.conventionId &&
    ticketType.includedTournamentIds.includes(tournament._id)
  );
}

// The account-holder shape of the comp check, for the self-serve entry
// points that know a user rather than a participant.
export async function badgeCompsChildEvent(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  userId: Id<"users">,
) {
  const participant = await participantForUser(ctx, userId);
  if (!participant) {
    return false;
  }
  return await participantBadgeCompsChildEvent(ctx, tournament, participant._id);
}

// Attach/detach rules. Both directions require organizer access to the
// convention (the adapter resolves it) and act only on children still in
// setup or registration: an event that has started or finished keeps
// whatever association it had, so history is never silently rewritten
// (TODO.md §4). Same-organization is structural — a convention can only
// ever hold its own organization's events.
export async function attachTournamentToConvention(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    tournament: Doc<"tournaments">;
    actor: Doc<"users">;
  },
) {
  if (args.tournament.organizationId !== args.convention.organizationId) {
    throw new Error("Tournament belongs to a different organization");
  }
  if (
    args.convention.lifecycle === "completed" ||
    args.convention.lifecycle === "cancelled"
  ) {
    throw new Error("Convention is already over");
  }
  if (args.tournament.conventionId === args.convention._id) {
    return;
  }
  if (args.tournament.conventionId !== undefined) {
    throw new Error("Tournament is already part of another convention");
  }
  if (
    args.tournament.lifecycle !== "setup" &&
    args.tournament.lifecycle !== "registration"
  ) {
    throw new Error("Only events that have not started can join a convention");
  }
  await ctx.db.patch(args.tournament._id, {
    conventionId: args.convention._id,
    updatedAt: Date.now(),
  });
  await logConventionAuditEvent(ctx, {
    conventionId: args.convention._id,
    actor: args.actor,
    actorRole: "organizer",
    event: {
      type: "tournament_attached",
      tournamentId: args.tournament._id,
      tournamentName: args.tournament.name,
    },
  });
}

export async function detachTournamentFromConvention(
  ctx: MutationCtx,
  args: {
    convention: Doc<"conventions">;
    tournament: Doc<"tournaments">;
    actor: Doc<"users">;
  },
) {
  if (args.tournament.conventionId !== args.convention._id) {
    throw new Error("Tournament is not part of this convention");
  }
  if (
    args.tournament.lifecycle !== "setup" &&
    args.tournament.lifecycle !== "registration"
  ) {
    throw new Error("Events that have started keep their convention history");
  }
  await ctx.db.patch(args.tournament._id, {
    conventionId: undefined,
    updatedAt: Date.now(),
  });
  await logConventionAuditEvent(ctx, {
    conventionId: args.convention._id,
    actor: args.actor,
    actorRole: "organizer",
    event: {
      type: "tournament_detached",
      tournamentId: args.tournament._id,
      tournamentName: args.tournament.name,
    },
  });
}
