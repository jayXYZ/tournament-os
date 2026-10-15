import type {
  IndexRangeBuilder,
  OrderedQuery,
  PaginationOptions,
} from "convex/server";

import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { RegistrationFilter } from "../validators";
import { ORGANIZER_LIST_PAGE_SIZE } from "./pagination";
import { participantForUser, participantPublicIdentity } from "./participants";

// Hard ceiling on players (and therefore matches) per tournament. Bounds every
// per-tournament `.take(...)` so list and standings queries stay well under
// Convex's 4,096 index-ranges-read-per-transaction limit. Raising this requires
// re-checking that the read queries denormalize joins (see playerName fields)
// and that the organizer readers' one-read-per-nameless-row fallback
// (resolveOrganizerDisplayName) still fits beside the query's own ranges.
export const MAX_TOURNAMENT_PLAYERS = 2048;

// Registration and badge rows one re-stamp rewrites when an account's name or
// email changes (syncRegistrationNameStamps): one prefix range per table over
// the participant's rows. Far above any real player's history; a history past
// the bound keeps its old labels on rows beyond it.
const NAME_RESTAMP_BOUND = 1024;

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

// The two name fields stamped onto a registration row (tournament entry or
// convention badge) at write time, so list queries skip the user join:
//
// - playerName is the PLAYER-SAFE name: the account's name and nothing else.
//   It is the copy carried onward onto standings rows, match players, and
//   meeting seats, which other players read (the player standings, a
//   seatmate's name), so the stamp itself must be safe to show anyone. An
//   account without a name stamps nothing here.
// - organizerLabel is the ORGANIZER label: the same name, or the account's
//   email when it has none, so an organizer can still tell who a nameless
//   player is and the roster search (search_organizerLabel) can still find
//   them. It lives only on the registration row, which is returned to its
//   holder and to organizers and to no one else — never copy it onto a row
//   other players read, and never return it from a player-facing query.
//   The organizer-only audit logs stamp the same label at append time
//   (model/auditLog.ts auditPlayerLabel).
//
// Both stamps are kept current: upsertUser re-stamps the account's rows when
// its name or email changes (syncRegistrationNameStamps), so an absent
// playerName means the account has no name today — not a stale stamp — and
// the player-facing standings query can treat the stamp as the whole answer
// without reading through to user documents.
export type RegistrationNameStamp = {
  playerName: string | undefined;
  organizerLabel: string | undefined;
};

export function registrationNameStamp(identity: {
  name?: string;
  email?: string;
}): RegistrationNameStamp {
  const playerName = identity.name ?? undefined;
  return {
    playerName,
    organizerLabel: playerName ?? identity.email ?? undefined,
  };
}

// The organizer label of a registration or badge row already in hand: no
// read. Only organizer-gated readers may show the result.
export function registrationOrganizerLabel(row: {
  playerName?: string;
  organizerLabel?: string;
}): string | undefined {
  return row.organizerLabel ?? row.playerName;
}

// Name for a player as other players may see it, preferring the denormalized
// copy and only reading through to the participant's public identity when a
// registration lacks one. Used by readers as the fallback path so a missing
// denormalized name never blocks correctness. Safe for player-facing
// surfaces: neither the stamp nor the fallback ever yields an email.
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

// The organizer label for a row that carries only the player-safe copy (a
// standings row, a match player, a meeting seat): the copy when present,
// otherwise one read of the registration for its organizerLabel. Only
// organizer-gated queries may call this; it must never feed a player-facing
// response or a denormalized field. Budget: at most one document read per
// nameless row, so a reader over MAX_TOURNAMENT_PLAYERS rows spends at most
// that many reads on names even if every account were nameless — within the
// 4,096-range transaction limit beside the reader's own ranges (the
// per-row participant and user reads a live identity lookup would add are
// exactly what the stamp exists to avoid).
export async function resolveOrganizerDisplayName(
  ctx: QueryCtx,
  playerName: string | undefined,
  registrationId: Id<"tournamentRegistrations">,
): Promise<string | undefined> {
  if (playerName !== undefined) {
    return playerName;
  }
  const registration = await ctx.db.get(registrationId);
  return registration ? registrationOrganizerLabel(registration) : undefined;
}

// Rewrites the name stamps on every row an account holds after its name or
// email changed at sign-in (the only writer of users.name): its tournament
// registrations and convention badges in every entry status, plus the
// player-safe copy on each confirmed registration's row in its tournament's
// latest completed round — the row getLatestStandings reads (found the way
// model/participation.ts latestStandingsRowFor finds it: the newest row by
// player, since rows are only ever created at round completion and rewinds
// delete the reopened round's). Match players and meeting seats are
// per-round snapshots and are left alone: the organizer readers resolve
// their nameless rows through the registration's fresh label, and the
// player-facing seatmate name is name-only by construction. Rows whose
// stamps already match are skipped, so an unchanged sign-in writes nothing.
export async function syncRegistrationNameStamps(
  ctx: MutationCtx,
  userId: Id<"users">,
  stamp: RegistrationNameStamp,
  now: number,
): Promise<void> {
  const participant = await participantForUser(ctx, userId);
  if (!participant) {
    return;
  }
  const isStale = (row: { playerName?: string; organizerLabel?: string }) =>
    row.playerName !== stamp.playerName ||
    row.organizerLabel !== stamp.organizerLabel;

  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex(
      "by_participantId_and_entryStatus_and_tournamentStartDate",
      (q) => q.eq("participantId", participant._id),
    )
    .take(NAME_RESTAMP_BOUND);
  for (const registration of registrations) {
    if (isStale(registration)) {
      await ctx.db.patch(registration._id, { ...stamp, updatedAt: now });
    }
    if (registration.entryStatus !== "confirmed") {
      continue;
    }
    const [standingsRow] = await ctx.db
      .query("roundStandings")
      .withIndex("by_playerId", (q) => q.eq("playerId", registration._id))
      .order("desc")
      .take(1);
    if (standingsRow && standingsRow.playerName !== stamp.playerName) {
      await ctx.db.patch(standingsRow._id, {
        playerName: stamp.playerName,
        updatedAt: now,
      });
    }
  }

  const badges = await ctx.db
    .query("conventionRegistrations")
    .withIndex("by_participantId_and_entryStatus", (q) =>
      q.eq("participantId", participant._id),
    )
    .take(NAME_RESTAMP_BOUND);
  for (const badge of badges) {
    if (isStale(badge)) {
      await ctx.db.patch(badge._id, { ...stamp, updatedAt: now });
    }
  }
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
// named by the state it would lift the entry out of, or null when the action
// is unavailable: confirm a pending application, promote a waitlisted one
// (approval doubles as manual waitlist promotion), or reverse a rejection —
// the deliberate way back that registerSelf refuses to be. Every arm lands
// in the same confirmed seat, so the previous state is the whole decision —
// it is what the approval's audit event records. Admission decisions exist
// only while registration is open: once play starts the way in is the future
// late-entry override and the way out is a drop. approveEntry enforces this
// rule; approval takes a seat, so capacity applies there.
export function registrationApproveEffect(
  lifecycle: Doc<"tournaments">["lifecycle"],
  registration: Doc<"tournamentRegistrations">,
): "pending" | "waitlisted" | "rejected" | null {
  if (lifecycle !== "registration") {
    return null;
  }
  return registration.entryStatus === "pending" ||
    registration.entryStatus === "waitlisted" ||
    registration.entryStatus === "rejected"
    ? registration.entryStatus
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
      // Only an active player can be removed by rejection. A rejection's
      // sanctioned reversal (approveEntry) re-admits to active play, so a
      // row carrying a competitive record — a drop preserved by a round-one
      // rewind — would have that record silently flattened by a
      // reject-then-approve round trip. The arm refuses instead: the ways to
      // act on a dropped row stay reinstate (undo the drop) and cancel
      // (release the held seat), and rejecting the row once cancelled still
      // bars re-entry.
      return registration.participationStatus === "active" ? "remove" : null;
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

// The entry-review actions available on a registration row right now, as the
// organizer roster ships them to the client: the same projections the verbs
// enforce, with the approve arm additionally composed with the capacity rule
// approveEntry applies — approval takes a seat, so a full event offers no
// approve action (rejecting and waitlisting take no seat and stay
// available). One bundle, so a roster row can never offer an action its verb
// would refuse.
export function entryReviewActions(
  tournament: Doc<"tournaments">,
  registration: Doc<"tournamentRegistrations">,
) {
  const approveEffect = registrationApproveEffect(
    tournament.lifecycle,
    registration,
  );
  return {
    approveEffect:
      approveEffect !== null && hasCapacityAvailable(tournament)
        ? approveEffect
        : null,
    rejectEffect: registrationRejectEffect(tournament.lifecycle, registration),
    waitlistEffect: registrationWaitlistEffect(
      tournament.lifecycle,
      registration,
    ),
  };
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
  const statuses = ["dropped", "eliminated", "disqualified"] as const;
  const pages = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("tournamentRegistrations")
        .withIndex(
          "by_tournamentId_and_entryStatus_and_participationStatus",
          (q) =>
            q
              .eq("tournamentId", tournamentId)
              .eq("entryStatus", "confirmed")
              .eq("participationStatus", status),
        )
        .take(MAX_TOURNAMENT_PLAYERS),
    ),
  );
  for (const [index, registrations] of pages.entries()) {
    for (const registration of registrations) {
      byRegistrationId.set(registration._id, statuses[index]);
    }
  }
  return byRegistrationId;
}

// A participation status only exists on confirmed entries, so filtering to
// one pins entryStatus too (see registrationFilterValidator).
type ParticipationFilter = NonNullable<
  Doc<"tournamentRegistrations">["participationStatus"]
>;

function isParticipationFilter(
  filter: RegistrationFilter,
): filter is ParticipationFilter {
  switch (filter) {
    case "active":
    case "dropped":
    case "eliminated":
    case "disqualified":
      return true;
    case "awaiting_review":
    case "waitlisted":
    case "confirmed":
    case "cancelled":
    case "rejected":
      return false;
  }
}

// The index range one Registrations tab filter stands for (see
// registrationFilterValidator): an entry status is a plain prefix of
// by_tournamentId_and_entryStatus_and_awaitingReview; the review queue is
// the pending rows that carry the flag. Both the list and the count read
// this, so "pending review" means the same rows everywhere. A participation
// status is a prefix of the other roster index instead
// (participationFilterRange).
function registrationFilterRange(
  q: IndexRangeBuilder<
    Doc<"tournamentRegistrations">,
    ["tournamentId", "entryStatus", "awaitingReview", "_creationTime"]
  >,
  tournamentId: Id<"tournaments">,
  filter: Exclude<RegistrationFilter, ParticipationFilter>,
) {
  const scoped = q.eq("tournamentId", tournamentId);
  return filter === "awaiting_review"
    ? scoped.eq("entryStatus", "pending").eq("awaitingReview", true)
    : scoped.eq("entryStatus", filter);
}

// The index range a participation-status filter stands for: the confirmed
// entries in that competitive state, a prefix of
// by_tournamentId_and_entryStatus_and_participationStatus.
function participationFilterRange(
  q: IndexRangeBuilder<
    Doc<"tournamentRegistrations">,
    ["tournamentId", "entryStatus", "participationStatus", "_creationTime"]
  >,
  tournamentId: Id<"tournaments">,
  filter: ParticipationFilter,
) {
  return q
    .eq("tournamentId", tournamentId)
    .eq("entryStatus", "confirmed")
    .eq("participationStatus", filter);
}

// One page of a tournament's registration history, newest first — or, under
// a filter, only that slice of it: one entry status, one participation
// status of the confirmed entries, or the review queue (the applications
// awaiting a decision). The filter picks the index. Every walk is a plain
// index-equality prefix, so without a payment filter every row read is a
// row returned, and every walk reads newest-first: the unfiltered walk
// orders on the startDate column, constant per tournament (reschedule syncs
// excepted, transiently) and so effectively on _creationTime; the filtered
// walks pin every column before the appended _creationTime and so order on
// it directly (the awaitingReview column is set only on the review queue,
// so a status prefix never regroups — a filtered confirmed list is not
// regrouped by participation status).
// No maximumRowsRead on the plain walks: a cap would buy no headroom — it
// would just equal numItems and trip on every full page (rowsRead reaches
// the cap on the same doc that fills the page), flagging a healthy page as
// SplitRequired/SplitRecommended and making usePaginatedQuery split and
// re-issue it instead of settling.
// The payment filter is the one post-index narrowing, and so the one walk
// that reads rows it does not return. paymentStatus has no index: one per
// walk above would double the roster's indexes, and an index range could
// not take the chip's OR of statuses under one cursor anyway. So it is a
// `.filter` over the status walk — run before the page is cut, so a page
// still holds numItems matching rows rather than whatever survived of an
// unfiltered page — and that walk alone carries maximumRowsRead
// (PAYMENT_FILTER_ROWS_PER_PAGE): a page that reads that many rows is cut
// short as SplitRequired, usePaginatedQuery splits it and pages on from its
// continueCursor, and a rare status on a large history costs a bounded read
// set per page (and per page subscription) instead of a scan to the first
// numItems matches or to the end of the history.
export async function paginateRegistrationHistory(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  filter: RegistrationFilter | undefined,
  paginationOpts: PaginationOptions,
  payment?: ReadonlyArray<PaymentOrderStatus>,
) {
  const walk = registrationHistoryWalk(ctx, tournamentId, filter);
  if (payment === undefined || payment.length === 0) {
    return await walk.paginate(paginationOpts);
  }
  return await walk
    .filter((q) =>
      q.or(...payment.map((status) => q.eq(q.field("paymentStatus"), status))),
    )
    // Spread, not rebuilt: the client's native fields (endCursor on a split
    // half, id) ride through untouched.
    .paginate({
      ...paginationOpts,
      maximumRowsRead: PAYMENT_FILTER_ROWS_PER_PAGE,
    });
}

// Rows a payment-filtered history page may read before it is cut short
// (paginate's maximumRowsRead; see paginateRegistrationHistory): ten full
// pages' worth, so a page settles whenever at least one row in ten carries
// the status, and a rarer one is paged through in windows of this many
// rows. Well clear of the page size, which is the one value a cap must not
// be: at numItems it would trip on the very row that fills the page.
export const PAYMENT_FILTER_ROWS_PER_PAGE = 10 * ORGANIZER_LIST_PAGE_SIZE;

function registrationHistoryWalk(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  filter: RegistrationFilter | undefined,
): RegistrationWalk {
  if (filter === undefined) {
    return ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .order("desc");
  }
  if (isParticipationFilter(filter)) {
    return ctx.db
      .query("tournamentRegistrations")
      .withIndex(
        "by_tournamentId_and_entryStatus_and_participationStatus",
        (q) => participationFilterRange(q, tournamentId, filter),
      )
      .order("desc");
  }
  return ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_awaitingReview", (q) =>
      registrationFilterRange(q, tournamentId, filter),
    )
    .order("desc");
}

type RegistrationWalk = OrderedQuery<DataModel["tournamentRegistrations"]>;
type PaymentOrderStatus = Doc<"paymentOrders">["status"];

// The pending-review count is a badge, not a ledger: past this many it reads
// "99+", so the count reads at most one row beyond it. Pending rows are not
// bounded by capacity (approval takes the seat), so an unbounded count could
// otherwise grow with a busy event's application churn.
export const PENDING_REVIEW_COUNT_CAP = 99;

// How many applications await the organizer's decision — the review queue
// (CONTEXT.md "Review Queue"), the same rows the Registrations tab's
// "Pending review" filter lists. Entry decisions exist only while
// registration is open (registrationApproveEffect and its siblings all
// return null elsewhere), so outside that lifecycle the count is zero
// whatever the rows say: a tournament that starts with undecided
// applications still lists them under the filter, but the badge never
// advertises work the organizer cannot act on. `capped` means at least
// cap + 1 rows exist and the caller should show the cap with an overflow
// mark rather than an exact number.
export async function pendingReviewCount(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
): Promise<{ count: number; capped: boolean }> {
  if (tournament.lifecycle !== "registration") {
    return { count: 0, capped: false };
  }
  const rows = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_awaitingReview", (q) =>
      registrationFilterRange(q, tournament._id, "awaiting_review"),
    )
    .take(PENDING_REVIEW_COUNT_CAP + 1);
  const capped = rows.length > PENDING_REVIEW_COUNT_CAP;
  return {
    count: capped ? PENDING_REVIEW_COUNT_CAP : rows.length,
    capped,
  };
}

// Name search across the full registration history. The search index
// prefix-matches the last term, which suits name-as-you-type, and results
// are relevance-ordered and bounded to one page — the caller never has to
// page older records in to find a player. Rows without a denormalized
// playerName (legacy data) are absent from the index and cannot match. The
// optional filters narrow the search to the same rows they narrow
// paginateRegistrationHistory to, so a filter and a search box compose —
// and every one of them is a filter field of the index, never a `.filter`
// after it: a search reads at most 1024 ranked rows out of the index, and a
// post-filter would see only those, reporting a matching player ranked past
// them as absent. The index takes one equality per field, so the payment
// chip's OR of statuses is one search per status, merged by rank below.
export async function searchRegistrationHistory(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  search: string,
  filter: RegistrationFilter | undefined,
  payment?: ReadonlyArray<PaymentOrderStatus>,
) {
  const matches = (paymentStatus: PaymentOrderStatus | undefined) =>
    ctx.db
      .query("tournamentRegistrations")
      .withSearchIndex("search_organizerLabel", (q) => {
        const scoped = q
          .search("organizerLabel", search)
          .eq("tournamentId", tournamentId);
        const byPayment =
          paymentStatus === undefined
            ? scoped
            : scoped.eq("paymentStatus", paymentStatus);
        if (filter === undefined) {
          return byPayment;
        }
        if (isParticipationFilter(filter)) {
          return byPayment
            .eq("entryStatus", "confirmed")
            .eq("participationStatus", filter);
        }
        return filter === "awaiting_review"
          ? byPayment.eq("entryStatus", "pending").eq("awaitingReview", true)
          : byPayment.eq("entryStatus", filter);
      })
      .take(ORGANIZER_LIST_PAGE_SIZE);
  if (payment === undefined || payment.length === 0) {
    return await matches(undefined);
  }
  return interleaveByRank(
    await Promise.all(payment.map((status) => matches(status))),
    ORGANIZER_LIST_PAGE_SIZE,
  );
}

// One page of best matches out of several relevance-ordered lists (one per
// payment status): round-robin by rank, so a status with a full page of
// matches cannot push another status's only match off the page, and each
// status's rows keep their own relevance order. The lists are disjoint — a
// row carries one payment status — so nothing repeats.
function interleaveByRank<T>(
  lists: ReadonlyArray<ReadonlyArray<T>>,
  limit: number,
): Array<T> {
  const merged: Array<T> = [];
  const deepest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < deepest && merged.length < limit; rank += 1) {
    for (const list of lists) {
      const row = list[rank];
      if (row !== undefined && merged.length < limit) {
        merged.push(row);
      }
    }
  }
  return merged;
}

// Structural over tournaments and conventions — both carry the same
// capacity/counter pair (see the conventions table comment in schema.ts).
export function hasCapacityAvailable(event: {
  confirmedRegistrationCount: number;
  playerCapacity: number;
}) {
  return event.confirmedRegistrationCount < event.playerCapacity;
}

export function requireCapacityAvailable(tournament: Doc<"tournaments">) {
  if (!hasCapacityAvailable(tournament)) {
    throw new Error("Tournament is at capacity");
  }
}

// Structural like hasCapacityAvailable above: tournaments and conventions
// keep the same clamped seat counter, so one writer adjusts both.
export async function adjustConfirmedRegistrationCount(
  ctx: MutationCtx,
  event: Doc<"tournaments"> | Doc<"conventions">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(event._id, {
    confirmedRegistrationCount: Math.max(
      0,
      event.confirmedRegistrationCount + delta,
    ),
    updatedAt: now,
  });
}
