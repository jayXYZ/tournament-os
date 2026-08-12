import {
  requiredGameWins,
  type BestOf,
} from "@tournament-os/shared/match-structure";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { applyMatchResult } from "./matchResults";
import { requirePhase } from "./phases";
import { createSeededRandom } from "./random";
import {
  adjustConfirmedRegistrationCount,
  registrationForUser,
} from "./registrations";
import { nextUserPublicCode } from "./users";
import {
  matchPlayers,
  requireTestTournament,
  requireTournament,
  roundMatches,
} from "./tournaments";

export type SimulatedMatchResult = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws: number;
};

// Scorelines are drawn from the phase's Match Structure: the winner takes the
// required game wins, the loser 0 or one short of winning, and a drawn match
// splits below the requirement (0–0 in best of 1). Best-of-3 output is
// identical to the pre-structure generator, so seeded expectations hold.
export function simulatedMatchResult(
  random: () => number,
  options: { bestOf: BestOf; allowDraws?: boolean },
): SimulatedMatchResult {
  const required = requiredGameWins(options.bestOf);
  const drawnWins = Math.min(1, required - 1);
  const roll = random();

  if (roll < 0.08) {
    if (options.allowDraws !== false) {
      return {
        playerOneGameWins: drawnWins,
        playerTwoGameWins: drawnWins,
        draws: 1,
      };
    }
    return random() < 0.5
      ? { playerOneGameWins: required, playerTwoGameWins: 0, draws: 0 }
      : { playerOneGameWins: 0, playerTwoGameWins: required, draws: 0 };
  }

  if (roll < 0.54) {
    return random() < 0.7
      ? { playerOneGameWins: required, playerTwoGameWins: 0, draws: 0 }
      : {
          playerOneGameWins: required,
          playerTwoGameWins: required - 1,
          draws: 0,
        };
  }

  return random() < 0.7
    ? { playerOneGameWins: 0, playerTwoGameWins: required, draws: 0 }
    : {
        playerOneGameWins: required - 1,
        playerTwoGameWins: required,
        draws: 0,
      };
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

  const remainingCapacity = Math.max(
    tournament.playerCapacity - tournament.confirmedRegistrationCount,
    0,
  );
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
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName: existingUser?.name ?? `Test Player ${playerNumber}`,
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
    created += 1;
    playerNumber += 1;
  }
  await adjustConfirmedRegistrationCount(ctx, tournament, created, now);
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
  const phase = await requirePhase(ctx, round.tournamentPhaseId);
  const matches = await roundMatches(ctx, round._id);
  const random = createSeededRandom(seed + round.roundNumber * 1000);

  for (const match of matches) {
    const players = await matchPlayers(ctx, match._id);
    if (players.length !== 2) {
      continue;
    }
    // Always drawn, even for matches the writer then skips as already
    // completed, so a given seed produces the same result sequence
    // regardless of how many rounds were simulated before.
    const result = simulatedMatchResult(random, {
      bestOf: phase.bestOf,
      allowDraws: phase.phaseType !== "single_elimination",
    });
    await applyMatchResult(ctx, {
      match,
      phase,
      round,
      players,
      playerOneGameWins: result.playerOneGameWins,
      playerTwoGameWins: result.playerTwoGameWins,
      policy: { kind: "simulation", audit: "none" },
    });
  }
}
