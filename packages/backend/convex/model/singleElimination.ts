import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { SINGLE_ELIMINATION_PLAYERS } from "./phases";
import {
  MAX_TOURNAMENT_PLAYERS,
  activeRegistrations,
  adjustActiveRegistrationCount,
  setRegistrationStatus,
} from "./registrations";
import type { RoundMatchWithPlayers } from "./standings";
import { roundMatchesWithPlayers } from "./tournaments";

export async function topEightFromStandings(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);

  const loadedRegistrations = await mapAsyncInBatches(
    standings,
    DATABASE_IO_BATCH_SIZE,
    async (standing) => await ctx.db.get(standing.playerId),
  );
  const registrations: Doc<"tournamentRegistrations">[] = [];
  for (const registration of loadedRegistrations) {
    if (
      registration?.status === "active" &&
      registrations.length < SINGLE_ELIMINATION_PLAYERS
    ) {
      registrations.push(registration);
    }
  }
  if (registrations.length === SINGLE_ELIMINATION_PLAYERS) {
    return registrations;
  }
  throw new Error("A top-8 playoff requires at least eight active players");
}

export async function eliminateNonQualifiers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  qualifiers: Doc<"tournamentRegistrations">[],
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const qualifierIds = new Set(
    qualifiers.map((registration) => registration._id),
  );
  const active = await activeRegistrations(ctx, tournament._id);
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  for (const registration of active) {
    if (!qualifierIds.has(registration._id)) {
      eliminated.push(registration);
    }
  }
  await eliminateRegistrations(
    ctx,
    tournament,
    eliminated,
    eliminatedByRoundId,
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
    if (winner?.status === "active") {
      advancers.push(winner);
      continue;
    }

    // A drop after recording the result is a withdrawal from the bracket, so
    // the opponent advances in that player's place. This also lets the round
    // complete and keeps the next-round field aligned with active players.
    const opponent = registrationsById.get(loserRow.playerId);
    if (opponent?.status !== "active") {
      throw new Error(
        "Single-elimination match has no active player to advance",
      );
    }
    advancers.push(opponent);
  }
  return { advancers, registrationsById };
}

export async function eliminateSingleEliminationLosers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  matchesWithPlayers: RoundMatchWithPlayers[],
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const { advancers, registrationsById } = await singleEliminationOutcome(
    ctx,
    matchesWithPlayers,
  );
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
  for (const id of eliminatedIds) {
    const registration = registrationsById.get(id);
    if (registration?.status === "active") {
      eliminated.push(registration);
    }
  }
  await eliminateRegistrations(
    ctx,
    tournament,
    eliminated,
    eliminatedByRoundId,
  );
}

async function eliminateRegistrations(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  registrations: Doc<"tournamentRegistrations">[],
  eliminatedByRoundId: Id<"tournamentRounds">,
) {
  const now = Date.now();
  await Promise.all([
    mapAsyncInBatches(
      registrations,
      DATABASE_IO_BATCH_SIZE,
      async (registration) =>
        await setRegistrationStatus(ctx, registration._id, {
          status: "eliminated",
          eliminatedByRoundId,
          updatedAt: now,
        }),
    ),
    adjustActiveRegistrationCount(ctx, tournament, -registrations.length, now),
  ]);
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
