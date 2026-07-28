import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { type CutoffPartition, cutoffPartition } from "./cutoffs";
import { SINGLE_ELIMINATION_PLAYERS } from "./phases";
import {
  activeRegistrations,
  prefetchStandingsSync,
  setRegistrationState,
  type StandingsSync,
} from "./registrations";
import type { RoundMatchWithPlayers } from "./standings";
import { roundMatchesWithPlayers } from "./tournaments";

// The top-8 playoff entry is a fixed top-X cut over the phase-final round's
// standings; the shared partition also names the dropped players who keep an
// elimination record (see eliminateNonQualifiers).
export async function topEightCutFromStandings(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
): Promise<CutoffPartition> {
  const cut = await cutoffPartition(ctx, roundId, {
    kind: "top_X_players",
    playerCount: SINGLE_ELIMINATION_PLAYERS,
  });
  if (cut.qualifiers.length !== SINGLE_ELIMINATION_PLAYERS) {
    throw new Error("A top-8 playoff requires at least eight active players");
  }
  return cut;
}

export async function eliminateNonQualifiers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  cut: CutoffPartition,
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const qualifierIds = new Set(
    cut.qualifiers.map((registration) => registration._id),
  );
  const active = await activeRegistrations(ctx, tournament._id);
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  for (const registration of active) {
    if (!qualifierIds.has(registration._id)) {
      eliminated.push(registration);
    }
  }
  // The cut is drawn from the round it stamps, and generateNextRound only
  // reaches here with that round completed and the next one not yet played, so
  // it is the tournament's latest completed round — the one whose standings
  // carry the denormalized status. Read its rows once for both batches below
  // instead of one index range per player removed.
  const standingsSync = await prefetchStandingsSync(ctx, eliminatedByRoundId);
  await eliminateRegistrations(
    ctx,
    eliminated,
    eliminatedByRoundId,
    standingsSync,
  );
  // Dropped non-qualifiers keep an elimination record too, so a rewind that
  // cleared a preserved elimination re-records it when the cut re-runs.
  await preserveDroppedEliminations(
    ctx,
    cut.droppedNonQualifiers,
    eliminatedByRoundId,
    standingsSync,
  );
}

export async function singleEliminationAdvancers(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const matchesWithPlayers = await roundMatchesWithPlayers(ctx, roundId);
  return (await singleEliminationOutcome(ctx, matchesWithPlayers)).advancers;
}

async function singleEliminationOutcome(
  ctx: QueryCtx,
  matchesWithPlayers: RoundMatchWithPlayers[],
) {
  const resultRows: Array<{
    winner: Doc<"tournamentMatchPlayers">;
    loser: Doc<"tournamentMatchPlayers">;
  }> = [];
  const playerIds = new Set<Id<"tournamentRegistrations">>();

  for (const { players } of matchesWithPlayers) {
    if (players.length !== 2) {
      throw new Error("Single-elimination matches require exactly two players");
    }
    const [first, second] = players;
    const firstWins = first.gameWins ?? 0;
    const secondWins = second.gameWins ?? 0;
    if (firstWins === secondWins) {
      throw new Error("Single-elimination matches must have a winner");
    }
    const winner = firstWins > secondWins ? first : second;
    resultRows.push({ winner, loser: winner === first ? second : first });
    playerIds.add(first.playerId);
    playerIds.add(second.playerId);
  }

  const ids = [...playerIds];
  const registrations = await mapAsyncInBatches(
    ids,
    DATABASE_IO_BATCH_SIZE,
    async (id) => await ctx.db.get(id),
  );
  const registrationsById = new Map<
    Id<"tournamentRegistrations">,
    Doc<"tournamentRegistrations">
  >();
  ids.forEach((id, index) => {
    const registration = registrations[index];
    if (registration) {
      registrationsById.set(id, registration);
    }
  });

  const advancers: Doc<"tournamentRegistrations">[] = [];
  for (const { winner: winnerRow, loser: loserRow } of resultRows) {
    const winner = registrationsById.get(winnerRow.playerId);
    if (winner?.participationStatus === "active") {
      advancers.push(winner);
      continue;
    }

    // A drop after recording the result is a withdrawal from the bracket, so
    // the opponent advances in that player's place. This also lets the round
    // complete and keeps the next-round field aligned with active players.
    const opponent = registrationsById.get(loserRow.playerId);
    if (opponent?.participationStatus !== "active") {
      throw new Error(
        "Single-elimination match has no active player to advance",
      );
    }
    advancers.push(opponent);
  }
  // Players who lost on games. Distinct from "not advancing": a winner who
  // withdrew cedes their slot to the opponent without having lost the match.
  const loserIds = new Set(resultRows.map(({ loser }) => loser.playerId));
  return { advancers, registrationsById, loserIds };
}

export async function eliminateSingleEliminationLosers(
  ctx: MutationCtx,
  matchesWithPlayers: RoundMatchWithPlayers[],
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const { advancers, registrationsById, loserIds } =
    await singleEliminationOutcome(ctx, matchesWithPlayers);
  const winnerIds = new Set(advancers.map((registration) => registration._id));
  const eliminatedIds = new Set<Id<"tournamentRegistrations">>();
  for (const { players } of matchesWithPlayers) {
    for (const player of players) {
      if (!winnerIds.has(player.playerId)) {
        eliminatedIds.add(player.playerId);
      }
    }
  }
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  const droppedLosers: Doc<"tournamentRegistrations">[] = [];
  for (const id of eliminatedIds) {
    const registration = registrationsById.get(id);
    if (registration?.participationStatus === "active") {
      eliminated.push(registration);
    } else if (
      registration?.participationStatus === "dropped" &&
      loserIds.has(id)
    ) {
      // A dropped player who lost on games keeps an elimination record, so a
      // rewind that cleared a preserved elimination re-records it when the
      // round is re-completed. A dropped winner gets none: their loss is the
      // withdrawal itself, and reinstating them returns them to active play.
      droppedLosers.push(registration);
    }
  }
  // completeRound rewrites this round's standings immediately before calling
  // us, so it is the latest completed round and its rows are the ones the
  // status changes below have to reach. One range serves both batches.
  const standingsSync = await prefetchStandingsSync(ctx, eliminatedByRoundId);
  await eliminateRegistrations(
    ctx,
    eliminated,
    eliminatedByRoundId,
    standingsSync,
  );
  await preserveDroppedEliminations(
    ctx,
    droppedLosers,
    eliminatedByRoundId,
    standingsSync,
  );
}

async function eliminateRegistrations(
  ctx: MutationCtx,
  registrations: Doc<"tournamentRegistrations">[],
  eliminatedByRoundId: Id<"tournamentRounds">,
  standingsSync: StandingsSync,
) {
  const now = Date.now();
  await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) =>
      await setRegistrationState(
        ctx,
        registration._id,
        {
          entryStatus: "confirmed",
          participationStatus: "eliminated",
          eliminatedByRoundId,
          updatedAt: now,
        },
        standingsSync,
      ),
  );
}

// Stamps eliminatedByRoundId on dropped players whose elimination stands,
// without touching their withdrawal, so a later in-play reinstate restores
// them to eliminated instead of reviving them mid-bracket. Rows that already
// carry a preserved elimination keep it: the original round is the
// authoritative record (e.g. an earlier cut a later cut must not overwrite).
async function preserveDroppedEliminations(
  ctx: MutationCtx,
  registrations: Doc<"tournamentRegistrations">[],
  eliminatedByRoundId: Id<"tournamentRounds">,
  standingsSync: StandingsSync,
) {
  const unstamped = registrations.filter(
    (registration) => registration.eliminatedByRoundId === undefined,
  );
  const now = Date.now();
  await mapAsyncInBatches(
    unstamped,
    DATABASE_IO_BATCH_SIZE,
    async (registration) =>
      await setRegistrationState(
        ctx,
        registration._id,
        {
          entryStatus: "confirmed",
          participationStatus: "dropped",
          eliminatedByRoundId,
          updatedAt: now,
        },
        standingsSync,
      ),
  );
}

export function singleEliminationRoundName(playerCount: number) {
  if (playerCount === 4) {
    return "Semifinals";
  }
  if (playerCount === 2) {
    return "Finals";
  }
  throw new Error("Unexpected single-elimination bracket size");
}
