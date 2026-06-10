/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  comparableFromStats,
  compareStandingRows,
  recomputeStatsThroughRound,
} from "./model/standings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function createTest() {
  return convexTest(schema, modules);
}
type Test = ReturnType<typeof createTest>;

const organizerIdentity = {
  issuer: "https://convex.test",
  subject: "organizer",
  tokenIdentifier: "https://convex.test|organizer",
  email: "organizer@example.test",
  name: "Organizer",
};

test("Swiss pairings and fold-forward standings hold at player capacity", async () => {
  const t = createTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Capacity Event",
      dummyPlayerCount: 512,
      roundsToGenerate: 3,
      seed: 99,
      autoStart: true,
    },
  );

  for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
    const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
      tournamentId,
    });
    expect(round?.roundNumber).toBe(roundNumber);
    await authed.mutation(api.tournaments.testing.advanceTestRound, {
      tournamentId,
    });

    const standings = await authed.query(api.tournaments.rounds.getStandings, {
      roundId: round!._id,
    });
    expect(standings).toHaveLength(512);
    expect(standings.map((row) => row.rank)).toEqual(
      standings.map((_, index) => index + 1),
    );
    await expectStandingsMatchOracle(t, tournamentId, round!._id, roundNumber);
  }

  const setup = await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.status).toBe("completed");

  // Even field: no byes, and the pairing engine never repeats a pairing.
  const { pairKeys, byePlayerIds } = await collectPairingFacts(t, tournamentId);
  expect(byePlayerIds).toHaveLength(0);
  expect(new Set(pairKeys).size).toBe(pairKeys.length);
}, 60_000);

test("odd-sized Swiss events give byes to distinct players and stay consistent", async () => {
  const t = createTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Odd Field Event",
      dummyPlayerCount: 9,
      roundsToGenerate: 4,
      seed: 7,
      autoStart: true,
    },
  );

  let finalRound: Doc<"tournamentRounds"> | null = null;
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    finalRound = await authed.query(api.tournaments.rounds.getCurrentRound, {
      tournamentId,
    });
    expect(finalRound?.roundNumber).toBe(roundNumber);
    await authed.mutation(api.tournaments.testing.advanceTestRound, {
      tournamentId,
    });
  }

  const setup = await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.status).toBe("completed");

  // One bye per round, and never the same player twice while others are
  // still without one (9 players, 4 rounds).
  const { byePlayerIds } = await collectPairingFacts(t, tournamentId);
  expect(byePlayerIds).toHaveLength(4);
  expect(new Set(byePlayerIds).size).toBe(4);

  await expectStandingsMatchOracle(t, tournamentId, finalRound!._id, 4);
});

test("standings and pairings fall back to match history for legacy rows", async () => {
  const t = createTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Legacy Rows Event",
      dummyPlayerCount: 8,
      roundsToGenerate: 2,
      seed: 21,
      autoStart: true,
    },
  );

  const roundOne = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.testing.generateTestRoundResults, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundOne!._id,
  });

  // Simulate standings rows written before the cumulative fields existed.
  await t.run(async (ctx) => {
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", roundOne!._id),
      )
      .collect();
    for (const standing of standings) {
      await ctx.db.patch(standing._id, {
        gameWins: undefined,
        gameLosses: undefined,
        opponentIds: undefined,
        hasHadBye: undefined,
      });
    }
  });

  const roundTwoId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  await authed.mutation(api.tournaments.testing.generateTestRoundResults, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundTwoId,
  });

  // Pairing fallback must still see round-one opponents: 8 players in round
  // two can always avoid rematches.
  const { pairKeys } = await collectPairingFacts(t, tournamentId);
  expect(new Set(pairKeys).size).toBe(pairKeys.length);

  await expectStandingsMatchOracle(t, tournamentId, roundTwoId, 2);
});

async function expectStandingsMatchOracle(
  t: Test,
  tournamentId: Id<"tournaments">,
  roundId: Id<"tournamentRounds">,
  roundNumber: number,
) {
  await t.run(async (ctx) => {
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", roundId),
      )
      .collect();
    const oracle = await recomputeStatsThroughRound(
      ctx,
      tournamentId,
      roundNumber,
    );

    const expectedOrder = [...oracle.values()].sort((left, right) =>
      compareStandingRows(
        comparableFromStats(left, oracle),
        comparableFromStats(right, oracle),
      ),
    );
    expect(standings.map((row) => row.playerId)).toEqual(
      expectedOrder.map((stats) => stats.registration._id),
    );

    for (const [index, standing] of standings.entries()) {
      const stats = oracle.get(standing.playerId);
      expect(stats).toBeDefined();
      const comparable = comparableFromStats(stats!, oracle);

      expect(standing.rank).toBe(index + 1);
      expect(standing.matchPoints).toBe(stats!.matchPoints);
      expect(standing.matchWins).toBe(stats!.matchWins);
      expect(standing.matchLosses).toBe(stats!.matchLosses);
      expect(standing.matchDraws).toBe(stats!.matchDraws);
      expect(standing.gameWins).toBe(stats!.gameWins);
      expect(standing.gameLosses).toBe(stats!.gameLosses);
      expect(standing.hasHadBye).toBe(stats!.hasHadBye);
      expect([...(standing.opponentIds ?? [])].sort()).toEqual(
        [...stats!.opponentIds].sort(),
      );
      expect(standing.opponentMatchWinPct).toBeCloseTo(
        comparable.opponentMatchWinPct,
        12,
      );
      expect(standing.gameWinPct).toBeCloseTo(comparable.gameWinPct, 12);
      expect(standing.opponentGameWinPct).toBeCloseTo(
        comparable.opponentGameWinPct,
        12,
      );
    }
  });
}

async function collectPairingFacts(
  t: Test,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const matches = (await ctx.db.query("tournamentMatches").collect()).filter(
      (match) => match.tournamentId === tournamentId,
    );

    const pairKeys: string[] = [];
    const byePlayerIds: Id<"tournamentRegistrations">[] = [];
    for (const match of matches) {
      const players = await ctx.db
        .query("tournamentMatchPlayers")
        .withIndex("by_tournamentMatchId_and_playerId", (q) =>
          q.eq("tournamentMatchId", match._id),
        )
        .collect();
      if (players.length === 1 && players[0].isBye) {
        byePlayerIds.push(players[0].playerId);
      }
      if (players.length === 2) {
        pairKeys.push(
          [players[0].playerId, players[1].playerId].sort().join("|"),
        );
      }
    }

    return { pairKeys, byePlayerIds };
  });
}

async function seedOrganizer(t: Test) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      name: organizerIdentity.name,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      workosOrganizationId: "org_test",
      name: "Test Org",
      slug: "test-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      workosOrganizationId: "org_test",
      userId,
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });

    return { organizationId, userId };
  });
}
