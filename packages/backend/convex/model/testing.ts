import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createSeededRandom } from "./random";
import { matchPointsForResult } from "./standings";
import { nextUserPublicCode } from "./users";
import {
  activeRegistrations,
  adjustActiveRegistrationCount,
  matchPlayers,
  registrationForUser,
  requireTestTournament,
  requireTournament,
  roundMatches,
} from "./tournaments";

export type SimulatedMatchResult = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws: number;
};

export function simulatedMatchResult(random: () => number): SimulatedMatchResult {
  const roll = random();

  if (roll < 0.08) {
    return { playerOneGameWins: 1, playerTwoGameWins: 1, draws: 1 };
  }

  if (roll < 0.54) {
    return random() < 0.7
      ? { playerOneGameWins: 2, playerTwoGameWins: 0, draws: 0 }
      : { playerOneGameWins: 2, playerTwoGameWins: 1, draws: 0 };
  }

  return random() < 0.7
    ? { playerOneGameWins: 0, playerTwoGameWins: 2, draws: 0 }
    : { playerOneGameWins: 1, playerTwoGameWins: 2, draws: 0 };
}

export async function getTestConfig(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .unique();
}

export async function requireTestConfig(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const config = await getTestConfig(ctx, tournamentId);
  if (!config) {
    throw new Error("Test tournament config not found");
  }
  return config;
}

export async function seedTestPlayers(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  count: number,
) {
  const tournament = await requireTournament(ctx, tournamentId);
  requireTestTournament(tournament);
  const requestedCount = Math.trunc(count);
  if (requestedCount <= 0) {
    return 0;
  }

  const active = await activeRegistrations(ctx, tournamentId);
  const remainingCapacity = Math.max(tournament.playerCapacity - active.length, 0);
  const playersToCreate = Math.min(requestedCount, remainingCapacity);
  if (playersToCreate <= 0) {
    return 0;
  }

  const now = Date.now();
  let created = 0;
  let playerNumber = 1;

  while (created < playersToCreate) {
    const existingTestPlayer = await ctx.db
      .query("testTournamentPlayers")
      .withIndex("by_tournamentId_and_playerNumber", (q) =>
        q.eq("tournamentId", tournamentId).eq("playerNumber", playerNumber),
      )
      .unique();
    if (existingTestPlayer) {
      playerNumber += 1;
      continue;
    }

    const tokenIdentifier = `test:${tournamentId}:player:${playerNumber}`;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", tokenIdentifier),
      )
      .unique();
    const userId =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier,
        publicCode: await nextUserPublicCode(ctx, now),
        email: `player${playerNumber}@test.tournament.local`,
        name: `Test Player ${playerNumber}`,
        updatedAt: now,
      }));

    await ctx.db.insert("testTournamentPlayers", {
      tournamentId,
      userId,
      playerNumber,
      updatedAt: now,
    });

    const existingRegistration = await registrationForUser(
      ctx,
      tournamentId,
      userId,
    );
    if (!existingRegistration) {
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        status: "active",
        playerName: existingUser?.name ?? `Test Player ${playerNumber}`,
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
    created += 1;
    playerNumber += 1;
  }
  await adjustActiveRegistrationCount(ctx, tournament, created, now);
  return created;
}

export async function generateTestResults(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds">,
) {
  requireTestTournament(tournament);
  // Only tournaments created through createTestTournament have a config row;
  // events merely flagged as test events fall back to a deterministic seed.
  const config = await getTestConfig(ctx, tournament._id);
  const seed = config?.seed ?? Math.trunc(tournament._creationTime);
  const matches = await roundMatches(ctx, round._id);
  const random = createSeededRandom(seed + round.roundNumber * 1000);

  for (const match of matches) {
    const players = await matchPlayers(ctx, match._id);
    if (players.length !== 2) {
      continue;
    }
    const result = simulatedMatchResult(random);
    if (
      match.matchStatus === "completed" ||
      match.matchStatus === "confirmed"
    ) {
      continue;
    }

    const [playerOnePoints, playerTwoPoints] = matchPointsForResult(result);
    const now = Date.now();
    await ctx.db.patch(players[0]._id, {
      matchPointsEarned: playerOnePoints,
      gameWins: result.playerOneGameWins,
      gameLosses: result.playerTwoGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(players[1]._id, {
      matchPointsEarned: playerTwoPoints,
      gameWins: result.playerTwoGameWins,
      gameLosses: result.playerOneGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(match._id, {
      matchStatus: "completed",
      reportedByRegistrationId: undefined,
      updatedAt: now,
    });
  }
}
