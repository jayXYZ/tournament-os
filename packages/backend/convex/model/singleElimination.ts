import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { type CutoffPartition, cutoffPartition } from "./cutoffs";
import { eliminatePlayers } from "./participation";
import { SINGLE_ELIMINATION_PLAYERS } from "./phases";
import type { RoundMatchWithPlayers } from "./standings";
import { roundMatchesWithPlayers } from "./tournaments";

// The top-8 playoff entry is a fixed top-X cut over the phase-final round's
// standings; the shared partition also names the dropped players who keep an
// elimination record (see eliminateNonQualifiers in model/participation.ts).
export async function topEightCutFromStandings(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  roundId: Id<"tournamentRounds">,
): Promise<CutoffPartition> {
  const cut = await cutoffPartition(ctx, tournamentId, roundId, {
    kind: "top_X_players",
    playerCount: SINGLE_ELIMINATION_PLAYERS,
  });
  if (cut.qualifiers.length !== SINGLE_ELIMINATION_PLAYERS) {
    throw new Error("A top-8 playoff requires at least eight active players");
  }
  return cut;
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
  // completeRound calls this right after rewriting the round's standings, so
  // eliminatedByRoundId is the tournament's latest completed round — the
  // contract eliminatePlayers needs to land the status repair on that
  // round's rows.
  await eliminatePlayers(ctx, {
    active: eliminated,
    dropped: droppedLosers,
    byRoundId: eliminatedByRoundId,
  });
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
