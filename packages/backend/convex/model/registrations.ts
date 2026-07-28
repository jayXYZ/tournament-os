import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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

// Name for a player, preferring the denormalized copy and only reading through
// to the user document when a (legacy) registration lacks one. Used by readers
// as the fallback path so a missing denormalized name never blocks correctness.
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
  return playerDisplayName(await ctx.db.get(registration.userId));
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

export async function registrationForUser(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_userId", (q) =>
      q.eq("tournamentId", tournamentId).eq("userId", userId),
    )
    .unique();
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

// What the organizer "drop player" action would do to a registration right
// now, or null when the action is unavailable. Before play the action cancels
// the entry (freeing the seat), so it also covers dropped rows a round-one
// rewind preserved; in play, active and eliminated players can still
// withdraw, while dropped and disqualified ones cannot drop again.
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

// Every confirmed entrant who has withdrawn. Read from the index range rather
// than by joining registrations to a round's standings: the withdrawn field is
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
// the copy denormalized onto the standings row instead (see
// syncStandingParticipationStatus) — do not reintroduce this scan there.
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

type RegistrationStateUpdate =
  | {
      entryStatus: "confirmed";
      participationStatus: "eliminated";
      eliminatedByRoundId: Id<"tournamentRounds">;
    }
  | {
      entryStatus: "confirmed";
      participationStatus: "dropped" | "disqualified";
      // A drop or disqualification records only the removal from active
      // play: when omitted, the helper keeps the row's existing
      // eliminatedByRoundId, so removing an already-eliminated player can
      // never make them revivable — a later reinstate restores the
      // elimination instead of returning them to active play. Pass a round
      // id to stamp an elimination alongside the removal, or null to
      // deliberately clear a preserved one (e.g. a rewind undoing the round
      // that eliminated them). Disqualification shares dropped's contract
      // rather than eliminated's or active's: like a drop, it removes a
      // player from play without the tournament having run its course for
      // them, so an existing elimination record is a fact about *when* they
      // left, not something disqualification supersedes.
      eliminatedByRoundId?: Id<"tournamentRounds"> | null;
    }
  | {
      entryStatus: "confirmed";
      participationStatus: "active";
      eliminatedByRoundId?: never;
    }
  | {
      entryStatus: "pending" | "waitlisted" | "cancelled" | "rejected";
      participationStatus?: never;
      eliminatedByRoundId?: never;
    };

// How a status change reaches the copy denormalized onto roundStandings.
// Omitted, setRegistrationState finds the row itself, which costs one index
// range and one patch per call — right for the single-registration callers (a
// self-drop, an organizer drop or reinstate) and wrong for the batches, which
// change every non-qualifier in one transaction and would pay that per player.
// The two fields the sync touches on a standings row. Kept this narrow so a
// caller that already holds the rows can build a sync without re-reading them
// — in particular replaceStandingsForRound, which knows everything about the
// rows it just inserted except the _creationTime a full Doc would demand. A
// full Doc<"roundStandings"> satisfies it.
export type StandingsSyncRow = Pick<
  Doc<"roundStandings">,
  "_id" | "participationStatus"
>;

export type StandingsSync =
  // The latest completed round's rows, read (or written) once for a whole
  // batch. A player absent from the map has no row in that round, which is
  // exactly what the per-registration lookup finds for a player with no
  // standings at all.
  | {
      kind: "prefetchedRound";
      rowsByPlayerId: Map<Id<"tournamentRegistrations">, StandingsSyncRow>;
    }
  // The caller rewrites or deletes the very rows this would patch, later in
  // the same transaction, and repairs whatever it promotes in their place.
  | { kind: "deferredToCaller" };

export const DEFERRED_STANDINGS_SYNC: StandingsSync = {
  kind: "deferredToCaller",
};

// Keys already-held standings rows for the batch of per-registration syncs
// about to run against them, so a caller that has just read — or just written
// — the round's rows spends no second index range on the sync. Same contract
// as prefetchStandingsSync: the rows must be the tournament's LATEST COMPLETED
// round's, one per ranked player.
export function standingsSyncFromRows(
  rows: ReadonlyArray<
    StandingsSyncRow & { playerId: Id<"tournamentRegistrations"> }
  >,
): StandingsSync {
  return {
    kind: "prefetchedRound",
    rowsByPlayerId: new Map(
      rows.map((row) => [
        row.playerId,
        { _id: row._id, participationStatus: row.participationStatus },
      ]),
    ),
  };
}

// One index range over a whole round's standings, keyed for the batch of
// per-registration syncs about to run against it. Pass the tournament's LATEST
// COMPLETED round: that is the only round whose denormalized copies are kept
// current (see syncStandingParticipationStatus), and its rows are the ones the
// per-registration lookup would have found one index range at a time.
export async function prefetchStandingsSync(
  ctx: QueryCtx,
  latestCompletedRoundId: Id<"tournamentRounds">,
): Promise<StandingsSync> {
  const rows = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", latestCompletedRoundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  return standingsSyncFromRows(rows);
}

export async function setRegistrationState(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  update: RegistrationStateUpdate & {
    playerName?: string;
    tournamentStartDate?: number;
    updatedAt?: number;
  },
  standingsSync?: StandingsSync,
) {
  const { updatedAt = Date.now(), eliminatedByRoundId, ...fields } = update;
  // A drop or disqualification that doesn't mention eliminatedByRoundId
  // keeps the row's existing stamp (see RegistrationStateUpdate); every
  // other transition writes the field explicitly — eliminations set it, all
  // remaining states (and a drop/disqualification passing null) clear it.
  const keepExistingElimination =
    update.entryStatus === "confirmed" &&
    (update.participationStatus === "dropped" ||
      update.participationStatus === "disqualified") &&
    eliminatedByRoundId === undefined;
  // A non-confirmed entry carries no competitive state, and standings read a
  // missing status as "active" — the same value the non-active index ranges
  // used to report for such a row.
  const participationStatus =
    update.entryStatus === "confirmed" ? update.participationStatus : undefined;
  await ctx.db.patch(registrationId, {
    ...fields,
    participationStatus,
    ...(keepExistingElimination
      ? {}
      : { eliminatedByRoundId: eliminatedByRoundId ?? undefined }),
    updatedAt,
  });
  await syncStandingParticipationStatus(
    ctx,
    registrationId,
    participationStatus,
    updatedAt,
    standingsSync,
  );
}

// Writes the new participation status through to the player's standings row in
// the tournament's latest completed round.
//
// Standings rows are per-round snapshots, but the status shown beside a name
// ("Dropped", "Eliminated") has to be live: a status change lands BETWEEN
// rounds — a self-drop, an organizer drop or reinstate, the elimination batch
// a cut applies while the next phase's first round is being paired — always
// after the standings that display it were written. Refreshing the copy here,
// once per change, keeps it exact without the player standings query having to
// re-derive it on every execution for every subscribed client.
//
// Which row: replaceStandingsForRound is the only writer, and it inserts one
// batch per round completion, so a player's most recently created row is their
// row in the tournament's latest completed round — the only round
// getLatestStandings ever reads. Ordering by_playerId descending finds it in a
// single document read. Rewinds delete the reopened round's rows, so the newest
// survivor is again the latest completed round's. A player with no rows at all
// (registered after the last round completed, so not yet ranked anywhere) has
// nothing to update.
//
// A caller changing many registrations at once passes a StandingsSync instead,
// so the whole batch costs the one index range that built it rather than one
// per player — or none at all when the caller is about to discard the rows.
async function syncStandingParticipationStatus(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  participationStatus: Doc<"tournamentRegistrations">["participationStatus"],
  updatedAt: number,
  standingsSync?: StandingsSync,
) {
  if (standingsSync?.kind === "deferredToCaller") {
    return;
  }
  const latest = standingsSync
    ? standingsSync.rowsByPlayerId.get(registrationId)
    : (
        await ctx.db
          .query("roundStandings")
          .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
          .order("desc")
          .take(1)
      )[0];
  if (!latest || latest.participationStatus === participationStatus) {
    return;
  }
  await ctx.db.patch(latest._id, { participationStatus, updatedAt });
  // Keep the prefetched copy in step with disk so a second change to the same
  // player inside one batch still short-circuits on an unchanged status.
  standingsSync?.rowsByPlayerId.set(registrationId, {
    _id: latest._id,
    participationStatus,
  });
}
