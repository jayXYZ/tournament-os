import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { participantForUser, participantPublicIdentity } from "./participants";

// Hard ceiling on players (and therefore matches) per tournament. Bounds every
// per-tournament `.take(...)` so list and standings queries stay well under
// Convex's 4,096 index-ranges-read-per-transaction limit. Raising this requires
// re-checking that the read queries denormalize joins (see playerName fields).
export const MAX_TOURNAMENT_PLAYERS = 2048;

// Write budget per transaction when re-syncing the denormalized
// tournamentStartDate after a reschedule, matching DELETE_BATCH_SIZE in
// model/deletion.ts. Registration churn on a large event can exceed this, so
// callers reschedule until every row matches.
export const START_DATE_SYNC_BATCH_SIZE = 512;

// Patches up to START_DATE_SYNC_BATCH_SIZE registrations whose denormalized
// tournamentStartDate is stale. "Stale" is expressed as the two
// by_tournamentId_and_tournamentStartDate half-ranges on either side of the
// target (an index range cannot say !=), so a batch reads only stale rows —
// cancelled churn included — never the already-synced remainder, and a full
// chain costs reads linear in the tournament's rows. Returns true once both
// ranges are empty; false means rows may remain and the caller should run
// another batch (e.g. by rescheduling itself via ctx.scheduler.runAfter).
// Staleness is recomputed against the startDate the caller read in this
// transaction, so a reschedule landing mid-chain simply makes previously
// synced rows stale again and every chain converges on the latest value.
export async function syncRegistrationStartDatesBatch(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  startDate: number,
): Promise<boolean> {
  const now = Date.now();
  const stale = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
      q.eq("tournamentId", tournamentId).lt("tournamentStartDate", startDate),
    )
    .take(START_DATE_SYNC_BATCH_SIZE);
  if (stale.length < START_DATE_SYNC_BATCH_SIZE) {
    stale.push(
      ...(await ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
          q
            .eq("tournamentId", tournamentId)
            .gt("tournamentStartDate", startDate),
        )
        .take(START_DATE_SYNC_BATCH_SIZE - stale.length)),
    );
  }
  for (const registration of stale) {
    await ctx.db.patch(registration._id, {
      tournamentStartDate: startDate,
      updatedAt: now,
    });
  }
  // A full page cannot prove the ranges are drained; the next batch observes
  // them empty and reports done.
  return stale.length < START_DATE_SYNC_BATCH_SIZE;
}

// Resolved display name for a user, mirroring the client's name fallback. Stored
// on registrations/standings/match players so list queries skip the user join.
export function playerDisplayName(
  user: Doc<"users"> | null | undefined,
): string | undefined {
  return user?.name ?? user?.email ?? undefined;
}

// Name for a player, preferring the denormalized copy and only reading
// through to the participant identity when a registration lacks one. Used by
// readers as the fallback path so a missing denormalized name never blocks
// correctness.
export async function registrationDisplayName(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<string | undefined> {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    return undefined;
  }
  if (registration.playerName !== undefined) {
    return registration.playerName;
  }
  const participant = await ctx.db.get(registration.participantId);
  if (!participant) {
    return undefined;
  }
  return (await participantPublicIdentity(ctx, participant)).name ?? undefined;
}

export async function resolveRegistrationDisplayName(
  ctx: QueryCtx,
  playerName: string | undefined,
  registrationId: Id<"tournamentRegistrations">,
) {
  return playerName ?? (await registrationDisplayName(ctx, registrationId));
}

// Seating order for player meetings: alphabetical by display name (case-
// insensitive, locale-aware), tie-broken by registration createdAt so players
// with identical names still seat deterministically (the same tie-break
// pairing and standings use).
export function comparePlayersAlphabetically(
  a: { playerName: string | null; createdAt: number },
  b: { playerName: string | null; createdAt: number },
) {
  const byName = (a.playerName ?? "").localeCompare(
    b.playerName ?? "",
    undefined,
    {
      sensitivity: "base",
    },
  );
  return byName !== 0 ? byName : a.createdAt - b.createdAt;
}

export async function requireRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }
  return registration;
}

export async function registrationForParticipant(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  participantId: Id<"participants">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_participantId", (q) =>
      q.eq("tournamentId", tournamentId).eq("participantId", participantId),
    )
    .unique();
}

// The account holder's registration for a tournament, resolved through their
// participant identity (registrations belong to participants, not users —
// see ADR 0002). Null when the user has no participant yet: every
// registration points at one, so none can exist.
export async function registrationForUser(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  userId: Id<"users">,
) {
  const participant = await participantForUser(ctx, userId);
  if (!participant) {
    return null;
  }
  return await registrationForParticipant(ctx, tournamentId, participant._id);
}

// Public/player-facing surfaces treat a disqualification as a drop; only
// organizer-authorized APIs expose the distinction. Every query that returns
// another player's participation status to a non-organizer must pass it
// through here so the masking never depends on client rendering.
export function playerVisibleParticipationStatus(
  status: Doc<"tournamentRegistrations">["participationStatus"] | null,
) {
  return status === "disqualified" ? "dropped" : (status ?? null);
}

// A registration row as player-facing queries return it: identical to the
// stored document except that a disqualification reads as a drop. Player
// surfaces branch on participationStatus (public event page, native app), so
// queries that hand a player their own row must mask it here — the same rule
// playerVisibleParticipationStatus enforces for other players' statuses — so
// the masking never depends on client rendering.
export function playerVisibleRegistration(
  registration: Doc<"tournamentRegistrations">,
): Doc<"tournamentRegistrations"> {
  return registration.participationStatus === "disqualified"
    ? { ...registration, participationStatus: "dropped" }
    : registration;
}

// What the organizer "drop player" action would do to a registration right
// now, or null when the action is unavailable. Before play the action cancels
// the entry (freeing the seat), so it also covers dropped rows a round-one
// rewind preserved; in play, active and eliminated players can still
// drop, while dropped and disqualified ones cannot drop again.
// dropRegistration enforces this rule and organizer roster rows report it, so
// the client renders the action without re-deriving the rule.
export function registrationDropEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "cancel" | "drop" | null {
  if (registration.entryStatus !== "confirmed") {
    return null;
  }
  if (lifecycle === "registration") {
    return registration.participationStatus === "active" ||
      registration.participationStatus === "dropped"
      ? "cancel"
      : null;
  }
  if (lifecycle !== "in_progress") {
    return null;
  }
  return registration.participationStatus === "dropped" ||
    registration.participationStatus === "disqualified"
    ? null
    : "drop";
}

// What the organizer "reinstate" action would do to a registration right
// now, or null when the action is unavailable — registrationDropEffect's
// counterpart. Before play a cancelled entry is restored to a confirmed seat
// (retaking one, so capacity applies — see restoreEntry in model/roster.ts);
// a dropped participant is reinstated to play in either live lifecycle,
// because a round-one rewind preserves drops into the reopened registration
// lifecycle and both need the way back. The roster verbs enforce this rule
// and reinstateRegistration routes on it.
export function registrationReinstateEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "restore" | "reinstate" | null {
  if (
    lifecycle === "registration" &&
    registration.entryStatus === "cancelled"
  ) {
    return "restore";
  }
  if (
    (lifecycle === "registration" || lifecycle === "in_progress") &&
    registration.entryStatus === "confirmed" &&
    registration.participationStatus === "dropped"
  ) {
    return "reinstate";
  }
  return null;
}

// What cancelling would do to a registration right now, or null when the
// action is unavailable: release a confirmed seat (the entry is cancelled,
// the seat count drops, and — because a cancelled row is the standing
// invitation back into a private event, see registerSelf — the player can
// later re-register), or withdraw a pending/waitlisted application, which
// never held a seat. cancelEntry routes on this; the organizer roster's drop
// button keeps offering only registrationDropEffect's confirmed-row
// "cancel", so the withdraw arm is the player's own way out of the review
// flow.
export function registrationCancelEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "release" | "withdraw" | null {
  if (lifecycle !== "registration") {
    return null;
  }
  if (
    registration.entryStatus === "pending" ||
    registration.entryStatus === "waitlisted"
  ) {
    return "withdraw";
  }
  return registrationDropEffect(lifecycle, registration) === "cancel"
    ? "release"
    : null;
}

// What the organizer "approve" action would do to a registration right now,
// or null when the action is unavailable: confirm a pending application,
// promote a waitlisted one (approval doubles as manual waitlist promotion),
// or reverse a rejection — the deliberate way back that registerSelf refuses
// to be. Admission decisions exist only while registration is open: once
// play starts the way in is the future late-entry override and the way out
// is a drop. approveEntry enforces this rule; approval takes a seat, so
// capacity applies there.
export function registrationApproveEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "confirm" | null {
  if (lifecycle !== "registration") {
    return null;
  }
  return registration.entryStatus === "pending" ||
    registration.entryStatus === "waitlisted" ||
    registration.entryStatus === "rejected"
    ? "confirm"
    : null;
}

// What the organizer "reject" action would do to a registration right now,
// or null when the action is unavailable. Three arms, because what a
// rejection takes away differs by where the entry stands: "decline" turns
// down a pending or waitlisted application; "remove" ejects a confirmed
// player and releases their seat; "bar" closes the door on a cancelled row,
// which would otherwise act as a standing invitation back into a private
// event (see registerSelf). Every arm ends in the same place — entryStatus
// "rejected", which registerSelf refuses to re-enter — so rejection is the
// one entry decision that sticks until an organizer approves the row again.
// rejectEntry enforces this rule.
export function registrationRejectEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "decline" | "remove" | "bar" | null {
  if (lifecycle !== "registration") {
    return null;
  }
  switch (registration.entryStatus) {
    case "pending":
    case "waitlisted":
      return "decline";
    case "confirmed":
      // Mirrors the drop button's acceptance set (active or dropped): an
      // eliminated participation cannot occur while registration is open,
      // and rejecting it would silently discard a competitive record if it
      // somehow did.
      return registrationDropEffect(lifecycle, registration) === "cancel"
        ? "remove"
        : null;
    case "cancelled":
      return "bar";
    case "rejected":
      return null;
  }
}

// What the organizer "waitlist" action would do to a registration right now,
// or null when the action is unavailable: hold a pending application on the
// waitlist instead of deciding it. Only pending rows — a confirmed seat is
// never bumped back to the waitlist, and the ways off it are approval,
// rejection, or the player's own withdrawal. waitlistEntry enforces this
// rule.
export function registrationWaitlistEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "waitlist" | null {
  return lifecycle === "registration" && registration.entryStatus === "pending"
    ? "waitlist"
    : null;
}

// The tournament's historical field: every confirmed entrant, including
// players who later dropped, were eliminated, or were disqualified. Cancelled,
// rejected, pending, and waitlisted rows are excluded at the index boundary,
// so registration churn cannot exceed the standings capacity assumption.
export async function participantRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_participationStatus", (q) =>
      q.eq("tournamentId", tournamentId).eq("entryStatus", "confirmed"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

export async function activeRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_participationStatus", (q) =>
      q
        .eq("tournamentId", tournamentId)
        .eq("entryStatus", "confirmed")
        .eq("participationStatus", "active"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

// Every confirmed entrant who has dropped. Read from the index range rather
// than by joining registrations to a round's standings: the dropped field is
// normally a small fraction of the roster, while standings carry a row per
// participant.
export async function droppedRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_participationStatus", (q) =>
      q
        .eq("tournamentId", tournamentId)
        .eq("entryStatus", "confirmed")
        .eq("participationStatus", "dropped"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

// Participation status for every confirmed entrant who is no longer active,
// keyed by registration id. Callers treat a missing key as "active".
//
// This costs reads — and subscription dependencies — proportional to the
// non-active field, which after a cut is nearly the whole event. Only the
// organizer standings view uses it, because it can display ANY completed
// round's standings and shows live status on all of them; its audience is the
// handful of staff running the event. The player-facing standings query reads
// the copy denormalized onto the standings row instead, which the
// participation module keeps current (see model/participation.ts) — do not
// reintroduce this scan there.
export async function nonActiveParticipationStatuses(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const byRegistrationId = new Map<
    Id<"tournamentRegistrations">,
    "dropped" | "eliminated" | "disqualified"
  >();
  for (const status of ["dropped", "eliminated", "disqualified"] as const) {
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex(
        "by_tournamentId_and_entryStatus_and_participationStatus",
        (q) =>
          q
            .eq("tournamentId", tournamentId)
            .eq("entryStatus", "confirmed")
            .eq("participationStatus", status),
      )
      .take(MAX_TOURNAMENT_PLAYERS);
    for (const registration of registrations) {
      byRegistrationId.set(registration._id, status);
    }
  }
  return byRegistrationId;
}

export function requireCapacityAvailable(tournament: Doc<"tournaments">) {
  if (tournament.confirmedRegistrationCount >= tournament.playerCapacity) {
    throw new Error("Tournament is at capacity");
  }
}

export async function adjustConfirmedRegistrationCount(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(tournament._id, {
    confirmedRegistrationCount: Math.max(
      0,
      tournament.confirmedRegistrationCount + delta,
    ),
    updatedAt: now,
  });
}
