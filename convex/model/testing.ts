import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { matchPointsForResult } from "./standings";
import {
  matchPlayers,
  registrationForUser,
  requireTestTournament,
  requireTournament,
  roundMatches,
  validCapacity,
} from "./tournaments";

export type SimulatedMatchResult = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws: number;
};

export function createSeededRandom(seed: number) {
  let state = Math.trunc(seed) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

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

export async function requireTestConfig(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const config = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .unique();
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
  const targetCount = Math.min(validCapacity(count), tournament.playerCapacity);
  const now = Date.now();

  for (let playerNumber = 1; playerNumber <= targetCount; playerNumber += 1) {
    const existingTestPlayer = await ctx.db
      .query("testTournamentPlayers")
      .withIndex("by_tournamentId_and_playerNumber", (q) =>
        q.eq("tournamentId", tournamentId).eq("playerNumber", playerNumber),
      )
      .unique();
    if (existingTestPlayer) {
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
        workosUserId: tokenIdentifier,
        email: `player${playerNumber}@test.tournament.local`,
        name: `Test Player ${playerNumber}`,
        createdAt: now,
        updatedAt: now,
      }));

    await ctx.db.insert("testTournamentPlayers", {
      tournamentId,
      userId,
      playerNumber,
      createdAt: now,
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
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
  }
}

export async function generateTestResults(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds">,
) {
  requireTestTournament(tournament);
  const config = await requireTestConfig(ctx, tournament._id);
  const matches = await roundMatches(ctx, round._id);

  for (const match of matches) {
    if (
      match.matchStatus === "completed" ||
      match.matchStatus === "confirmed"
    ) {
      continue;
    }
    const players = await matchPlayers(ctx, match._id);
    if (players.length !== 2) {
      continue;
    }

    const random = createSeededRandom(
      config.seed + round.roundNumber * 1000 + match.tableNumber,
    );
    const result = simulatedMatchResult(random);
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
    await ctx.db.patch(match._id, { matchStatus: "completed", updatedAt: now });
  }
}

export async function deleteTestTournamentOperationalData(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
) {
  const testPlayers = await ctx.db
    .query("testTournamentPlayers")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);

  for (const phase of phases) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(128);
    for (const round of rounds) {
      const matches = await roundMatches(ctx, round._id);
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      for (const match of matches) {
        const players = await matchPlayers(ctx, match._id);
        for (const player of players) {
          await ctx.db.delete(player._id);
        }
        await ctx.db.delete(match._id);
      }
      for (const standing of standings) {
        await ctx.db.delete(standing._id);
      }
      await ctx.db.delete(round._id);
    }
    await ctx.db.delete(phase._id);
  }

  for (const registration of registrations) {
    await ctx.db.delete(registration._id);
  }
  for (const testPlayer of testPlayers) {
    await ctx.db.delete(testPlayer._id);
    await ctx.db.delete(testPlayer.userId);
  }
  for (const config of configs) {
    await ctx.db.delete(config._id);
  }
}
