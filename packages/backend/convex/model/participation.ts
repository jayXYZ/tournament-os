import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import type { CutoffPartition } from "./cutoffs";
import { MAX_TOURNAMENT_PLAYERS, activeRegistrations } from "./registrations";
import { deleteStandingsForReopenedRound } from "./standings";

// The player-participation module: the one place that knows how a change to a
// player's participation reaches BOTH copies of that fact — the registration
// row (the source of truth) and the participationStatus denormalized onto the
// player's row in the tournament's latest completed round's standings, which
// is what every player's standings query reads (see getLatestStandings in
// tournaments/player.ts). Callers name the participation change they want: a
// single transition through setRegistrationState, a round's eliminations
// through eliminatePlayers, a cut through eliminateNonQualifiers, or a
// rewind's unwind through restoreEliminationsForRewind. How the standings
// copy is repaired — which rows, at what read cost, in what order relative to
// deletions — is decided here and nowhere else.

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

type RegistrationStateArgs = RegistrationStateUpdate & {
  playerName?: string;
  tournamentStartDate?: number;
  updatedAt?: number;
};

// The two fields a status repair touches on a standings row. Kept this narrow
// so already-held rows can feed a batch without a full Doc<"roundStandings">
// (which a fresh insert cannot supply — it lacks _creationTime). A full Doc
// satisfies it.
type StandingsRowRef = Pick<Doc<"roundStandings">, "_id" | "participationStatus">;

// Writes the registration-row half of a transition. Every operation in this
// module funnels through here, so the transition contract (the union typing
// above) is enforced in exactly one place; what varies per operation is only
// how the standings copy is repaired afterwards.
async function patchRegistrationRow(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  update: RegistrationStateArgs,
): Promise<{
  participationStatus: Doc<"tournamentRegistrations">["participationStatus"];
  updatedAt: number;
}> {
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
  // A non-confirmed entry carries no competitive state, so the registration
  // document legitimately clears its participationStatus. The standings copy
  // is another matter — see the guard in syncStatusOntoStandingsRow.
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
  return { participationStatus, updatedAt };
}

// Writes a new participation status through to a standings row, or returns
// undefined when the player has none to repair. Returns the row's resulting
// state so a batch can keep its held copy in step with disk.
async function syncStatusOntoStandingsRow(
  ctx: MutationCtx,
  participationStatus: Doc<"tournamentRegistrations">["participationStatus"],
  updatedAt: number,
  row: StandingsRowRef | undefined,
): Promise<StandingsRowRef | undefined> {
  if (!row) {
    return undefined;
  }
  // A registration leaving the confirmed state clears its participation
  // status (see patchRegistrationRow), but a standings row has no way to say
  // "no longer entered": every reader renders an absent status as "Active" —
  // the one thing a cancelled or rejected player is not — and the rewind
  // repair in deleteStandingsForReopenedRound would re-derive the same
  // "active" for a row whose registration is in no confirmed index range. No
  // stampable value is honest, and skipping the patch would freeze a stale
  // status instead, so a standings row implies a confirmed registration and
  // this refuses to break that invariant silently. Every non-confirmed
  // transition today runs in lifecycle "registration", where no standings
  // rows exist and the row lookup already came back empty; a caller adding
  // one that can reach a row (approval/rejection of a mid-play entry, a
  // mid-play cancel) trips this and must decide the row's fate explicitly —
  // keep the entry confirmed (e.g. "dropped"), or add a participation
  // operation that deletes or rewrites the player's standings in the same
  // transaction and skips this sync, the way restoreEliminationsForRewind
  // does. Checked before the unchanged-status short-circuit below: a row
  // whose stored status is absent (reads as active) would compare equal to
  // the cleared status and slip through exactly this case.
  if (participationStatus === undefined) {
    throw new Error(
      "Registration cannot leave the confirmed state while it holds a standings row: " +
        "standings render a missing participation status as active. Route the change " +
        "through a participation operation that deletes or rewrites the player's " +
        "standings in the same transaction, or keep the entry confirmed.",
    );
  }
  if (row.participationStatus === participationStatus) {
    return row;
  }
  await ctx.db.patch(row._id, { participationStatus, updatedAt });
  return { _id: row._id, participationStatus };
}

// A player's row in the tournament's latest completed round, found in a
// single document read.
//
// Standings rows are per-round snapshots, but the status shown beside a name
// ("Dropped", "Eliminated") has to be live: a status change lands BETWEEN
// rounds — a self-drop, an organizer drop or reinstate, the elimination batch
// a cut applies while the next phase's first round is being paired — always
// after the standings that display it were written. Refreshing the copy once
// per change keeps it exact without the player standings query having to
// re-derive it on every execution for every subscribed client.
//
// Which row: replaceStandingsForRound is the only writer, and it inserts one
// batch per round completion, so a player's most recently created row is their
// row in the tournament's latest completed round — the only round
// getLatestStandings ever reads. Rewinds delete the reopened round's rows, so
// the newest survivor is again the latest completed round's. A player with no
// rows at all (registered after the last round completed, so not yet ranked
// anywhere) has nothing to update.
async function latestStandingsRowFor(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<StandingsRowRef | undefined> {
  return (
    await ctx.db
      .query("roundStandings")
      .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
      .order("desc")
      .take(1)
  )[0];
}

// A single player's transition: one registration patch, one standings-row
// lookup, one repair patch. The union typing makes illegal registration
// transitions unrepresentable; the standings copy follows automatically.
export async function setRegistrationState(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  update: RegistrationStateArgs,
) {
  const { participationStatus, updatedAt } = await patchRegistrationRow(
    ctx,
    registrationId,
    update,
  );
  await syncStatusOntoStandingsRow(
    ctx,
    participationStatus,
    updatedAt,
    await latestStandingsRowFor(ctx, registrationId),
  );
}

function standingsRowsByPlayer(
  rows: ReadonlyArray<
    StandingsRowRef & { playerId: Id<"tournamentRegistrations"> }
  >,
): Map<Id<"tournamentRegistrations">, StandingsRowRef> {
  return new Map(
    rows.map((row) => [
      row.playerId,
      { _id: row._id, participationStatus: row.participationStatus },
    ]),
  );
}

// One row lookup per affected player. Right for the bracket-sized batches
// (fewer reads than a whole standings range); wrong for cut-sized ones,
// which go through eliminateNonQualifiers and cover the field in one range.
async function lookupStandingsRowsFor(
  ctx: MutationCtx,
  registrations: Doc<"tournamentRegistrations">[],
): Promise<Map<Id<"tournamentRegistrations">, StandingsRowRef>> {
  const rows = new Map<Id<"tournamentRegistrations">, StandingsRowRef>();
  await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) => {
      const row = await latestStandingsRowFor(ctx, registration._id);
      if (row) {
        rows.set(registration._id, {
          _id: row._id,
          participationStatus: row.participationStatus,
        });
      }
    },
  );
  return rows;
}

// Applies one transition to a batch of registrations, repairing each player's
// standings copy from the held rows. A player absent from the map has no row
// in the latest completed round — exactly what the per-player lookup finds
// for a player with no standings at all.
async function applyStateBatch(
  ctx: MutationCtx,
  registrations: Doc<"tournamentRegistrations">[],
  update: RegistrationStateArgs,
  rows: Map<Id<"tournamentRegistrations">, StandingsRowRef>,
) {
  await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) => {
      const { participationStatus, updatedAt } = await patchRegistrationRow(
        ctx,
        registration._id,
        update,
      );
      const synced = await syncStatusOntoStandingsRow(
        ctx,
        participationStatus,
        updatedAt,
        rows.get(registration._id),
      );
      // Keep the held copy in step with disk so a second change to the same
      // player inside one transaction still short-circuits on an unchanged
      // status.
      if (synced) {
        rows.set(registration._id, synced);
      }
    },
  );
}

// Withdrawn players whose elimination is not yet on record. Rows already
// carrying a preserved elimination keep it: the original round is the
// authoritative record of when the player left (e.g. an earlier cut a later
// cut must not overwrite).
function unstampedDrops(registrations: Doc<"tournamentRegistrations">[]) {
  return registrations.filter(
    (registration) => registration.eliminatedByRoundId === undefined,
  );
}

// The two halves of any elimination batch: active players leave play stamped
// "eliminated"; already-withdrawn players keep their withdrawal but gain the
// stamp (unless one exists), so a later in-play reinstate restores them to
// eliminated instead of reviving them past the round that cut them.
async function applyEliminations(
  ctx: MutationCtx,
  args: {
    active: Doc<"tournamentRegistrations">[];
    droppedToStamp: Doc<"tournamentRegistrations">[];
    byRoundId: Id<"tournamentRounds">;
    rows: Map<Id<"tournamentRegistrations">, StandingsRowRef>;
  },
) {
  const now = Date.now();
  await applyStateBatch(
    ctx,
    args.active,
    {
      entryStatus: "confirmed",
      participationStatus: "eliminated",
      eliminatedByRoundId: args.byRoundId,
      updatedAt: now,
    },
    args.rows,
  );
  await applyStateBatch(
    ctx,
    args.droppedToStamp,
    {
      entryStatus: "confirmed",
      participationStatus: "dropped",
      eliminatedByRoundId: args.byRoundId,
      updatedAt: now,
    },
    args.rows,
  );
}

// Records a round's eliminations: the active players its results remove from
// play, and the already-withdrawn players whose elimination it also has to
// record (a dropped player who lost on games — their withdrawal stands, the
// stamp keeps the loss on record).
//
// `byRoundId` must be the tournament's latest completed round. Both producers
// of eliminations satisfy that by construction — a bracket round's losers are
// recorded the moment the round completes — and it is what lands the
// standings-status repair on that round's rows. Sized for bracket batches (a
// handful of players, one single-document row lookup each); a cut's
// field-sized batch goes through eliminateNonQualifiers instead.
export async function eliminatePlayers(
  ctx: MutationCtx,
  args: {
    active: Doc<"tournamentRegistrations">[];
    dropped: Doc<"tournamentRegistrations">[];
    byRoundId: Id<"tournamentRounds">;
  },
) {
  const droppedToStamp = unstampedDrops(args.dropped);
  const rows = await lookupStandingsRowsFor(ctx, [
    ...args.active,
    ...droppedToStamp,
  ]);
  await applyEliminations(ctx, {
    active: args.active,
    droppedToStamp,
    byRoundId: args.byRoundId,
    rows,
  });
}

// Applies the elimination side of a cut (see the stamping invariant in
// model/cutoffs.ts): every active player outside the qualifiers is
// eliminated, and every dropped non-qualifier gets an elimination record, so
// no reinstate can grow the field past the cut it was drawn to.
//
// The cut is drawn from the round it stamps, and generateNextRound only
// reaches here with that round completed and the next one not yet played, so
// it is the tournament's latest completed round — the one whose standings
// carry the denormalized status. A partition that walked those standings
// hands back the active players outside the cut and the rows it walked, so
// nothing is re-read here; a seat-decided cut read neither, so both are
// fetched now — one roster range and one standings range for the whole batch
// either way.
export async function eliminateNonQualifiers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  cut: CutoffPartition,
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const { activeNonQualifiers, rows } = cut.elimination
    ? {
        activeNonQualifiers: cut.elimination.activeNonQualifiers,
        rows: standingsRowsByPlayer(cut.elimination.standings),
      }
    : await seatDecidedElimination(ctx, tournament, cut, eliminatedByRoundId);
  await applyEliminations(ctx, {
    active: activeNonQualifiers,
    droppedToStamp: unstampedDrops(cut.droppedNonQualifiers),
    byRoundId: eliminatedByRoundId,
    rows,
  });
}

// The elimination side of a cut whose partition never read the standings or
// the active roster (a live player meeting's seats decided it): everyone
// active outside the qualifying seats, plus the cut round's standings rows
// for the status repair.
async function seatDecidedElimination(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  cut: CutoffPartition,
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const qualifierIds = new Set(
    cut.qualifiers.map((registration) => registration._id),
  );
  const active = await activeRegistrations(ctx, tournament._id);
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", eliminatedByRoundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  return {
    activeNonQualifiers: active.filter(
      (registration) => !qualifierIds.has(registration._id),
    ),
    rows: standingsRowsByPlayer(standings),
  };
}

// Undoes the participation consequences of the rounds a rewind removes or
// reopens, and repairs the standings the rewind promotes back to "latest
// completed" — one operation, because only one internal ordering makes it
// correct.
//
// The registration restores run first, with no standings sync at all: the
// rows a sync would patch are the reopened round's — the latest completed
// round while this runs — and the deletion below throws every one of them
// away in the same transaction. Then deleteStandingsForReopenedRound deletes
// those rows and rebuilds the promoted round's denormalized statuses from
// the live registrations, which is exactly why it must run after the
// restores: run first, it would stamp the promoted rows from still-stale
// registrations. With no reopened round the tournament has no completed
// round and therefore no standings row anywhere, so there is nothing to
// delete or repair either way.
export async function restoreEliminationsForRewind(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  rounds: {
    // The in-progress round the rewind deletes.
    removedRound: Doc<"tournamentRounds">;
    // The completed round it reopens; null when rewinding the tournament's
    // first round back to registration.
    reopenedRound: Doc<"tournamentRounds"> | null;
  },
) {
  const sourceIds = new Set<Id<"tournamentRounds">>([
    rounds.removedRound._id,
    ...(rounds.reopenedRound ? [rounds.reopenedRound._id] : []),
  ]);
  const eliminated = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_participationStatus", (q) =>
      q
        .eq("tournamentId", tournament._id)
        .eq("entryStatus", "confirmed")
        .eq("participationStatus", "eliminated"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  const restored = eliminated.filter(
    (registration) =>
      registration.eliminatedByRoundId !== undefined &&
      sourceIds.has(registration.eliminatedByRoundId),
  );
  // Dropped players can carry a preserved elimination (a withdrawal after
  // being eliminated). The rewind undoes the elimination but the withdrawal
  // stands, so only the stale round reference is cleared.
  const dropped = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_entryStatus_and_participationStatus", (q) =>
      q
        .eq("tournamentId", tournament._id)
        .eq("entryStatus", "confirmed")
        .eq("participationStatus", "dropped"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  const clearedWithdrawals = dropped.filter(
    (registration) =>
      registration.eliminatedByRoundId !== undefined &&
      sourceIds.has(registration.eliminatedByRoundId),
  );
  const now = Date.now();
  await mapAsyncInBatches(
    restored,
    DATABASE_IO_BATCH_SIZE,
    async (registration) =>
      await patchRegistrationRow(ctx, registration._id, {
        entryStatus: "confirmed",
        participationStatus: "active",
        updatedAt: now,
      }),
  );
  await mapAsyncInBatches(
    clearedWithdrawals,
    DATABASE_IO_BATCH_SIZE,
    async (registration) =>
      await patchRegistrationRow(ctx, registration._id, {
        entryStatus: "confirmed",
        participationStatus: "dropped",
        // null clears the preserved elimination the rewind just undid.
        eliminatedByRoundId: null,
        updatedAt: now,
      }),
  );
  if (rounds.reopenedRound) {
    await deleteStandingsForReopenedRound(
      ctx,
      tournament._id,
      rounds.reopenedRound,
    );
  }
}
