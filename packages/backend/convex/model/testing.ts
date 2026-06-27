import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createSeededRandom } from "./random";
import { matchPointsForResult } from "./standings";
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

// Deletion budget per transaction. Each invocation deletes at most this many
// documents so a max-capacity test tournament (512 players x 16 rounds) stays
// within Convex transaction limits; callers reschedule until cleared.
const DELETE_BATCH_SIZE = 512;

// Deletes up to DELETE_BATCH_SIZE operational documents for a test
// tournament. Returns true once everything is cleared; false means more data
// remains and the caller should run another batch (e.g. by rescheduling
// itself via ctx.scheduler.runAfter).
export async function deleteTestTournamentOperationalDataBatch(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<boolean> {
  let budget = DELETE_BATCH_SIZE;
  // When a page comes back full there may be rows beyond the cursor, so the
  // pass cannot prove the tournament is cleared even if budget remains.
  let sawFullPage = false;

  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= phases.length === 16;

  for (const phase of phases) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(128);
    sawFullPage ||= rounds.length === 128;
    for (const round of rounds) {
      const matches = await roundMatches(ctx, round._id);
      sawFullPage ||= matches.length === 512;
      for (const match of matches) {
        const players = await matchPlayers(ctx, match._id);
        if (budget < players.length + 1) {
          return false;
        }
        for (const player of players) {
          await ctx.db.delete(player._id);
          budget -= 1;
        }
        await ctx.db.delete(match._id);
        budget -= 1;
      }
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      sawFullPage ||= standings.length === 512;
      for (const standing of standings) {
        if (budget < 1) {
          return false;
        }
        await ctx.db.delete(standing._id);
        budget -= 1;
      }
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(round._id);
      budget -= 1;
    }
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(phase._id);
    budget -= 1;
  }

  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= registrations.length === 512;
  for (const registration of registrations) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(registration._id);
    budget -= 1;
  }

  const testPlayers = await ctx.db
    .query("testTournamentPlayers")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= testPlayers.length === 512;
  for (const testPlayer of testPlayers) {
    if (budget < 2) {
      return false;
    }
    await ctx.db.delete(testPlayer._id);
    await ctx.db.delete(testPlayer.userId);
    budget -= 2;
  }

  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= configs.length === 16;
  for (const config of configs) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(config._id);
    budget -= 1;
  }

  return !sawFullPage;
}
