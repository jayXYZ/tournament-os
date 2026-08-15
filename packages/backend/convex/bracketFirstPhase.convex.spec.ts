/// <reference types="vite/client" />

// A single-elimination phase may open the tournament (TODO section 2): with
// no standings to seed from, the bracket is seeded by the tournament's random
// seed — concretely the per-player tiebreakRandom, fixed for the tournament —
// so the draw is reproducible across a rewind and restart (CONTEXT.md
// "Bracket").

import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

type Authed = ReturnType<ReturnType<typeof createConvexTest>["withIdentity"]>;

test("a single-elimination first phase must still be the final phase", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);

  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
        organizationId,
        name: "Bracket Then Swiss",
        startDate: Date.now(),
        playerCapacity: 8,
        format: "standard",
        phases: [
          {
            phaseOrder: 1,
            phaseType: "single_elimination",
            phaseRoundMode: "dynamic",
          },
          { phaseOrder: 2, phaseType: "swiss", phaseRoundMode: "dynamic" },
        ],
      }),
  ).rejects.toThrow("Single elimination must be the final phase");
});

test("a bracket-only tournament runs from seeded draw to completion", async () => {
  const t = createConvexTest();
  const { authed, tournamentId } = await createBracketOnlyTournament(t, 6);

  // Publishing needs a configured phase of any type — no Swiss required.
  const setupBoard = await authed.query(
    api.tournaments.rounds.getPairingsBoard,
    {
      tournamentId,
    },
  );
  expect(setupBoard.nextStep).toEqual({
    kind: "publishTournament",
    ready: true,
    reason: null,
  });
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  // Six players resolve to an eight-seat bracket: three rounds, opening at
  // the quarterfinals.
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.phases[0].phaseTotalRounds).toBe(3);
  const quarterfinal = await currentRoundStructure(t, authed, tournamentId);
  expect(quarterfinal.round.roundName).toBe("Quarterfinals");
  expect(quarterfinal.round.roundNumber).toBe(1);

  // Seeds follow tiebreakRandom descending (player 6 is seed 1 … player 1 is
  // seed 6). Standard eight-seat order: the two unfilled seats award seeds 1
  // and 2 first-round byes, and the played pairs are 4v5 and 3v6.
  expect(quarterfinal.byePlayers).toEqual([6, 5]);
  expect(quarterfinal.tables).toEqual([new Set([3, 2]), new Set([4, 1])]);

  // Upsets in both played quarterfinals: players 2 and 4 advance.
  await recordWinByNumber(t, authed, tournamentId, 2, 3);
  await recordWinByNumber(t, authed, tournamentId, 4, 1);
  await completeCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // Bracket halves must hold: seed 1's bye meets the 4v5 winner and seed 2's
  // bye meets the 3v6 winner — the top two seeds cannot meet before the
  // final.
  const semifinal = await currentRoundStructure(t, authed, tournamentId);
  expect(semifinal.round.roundName).toBe("Semifinals");
  expect(semifinal.byePlayers).toEqual([]);
  expect(semifinal.tables).toEqual([new Set([6, 2]), new Set([5, 4])]);

  await recordWinByNumber(t, authed, tournamentId, 2, 6);
  await recordWinByNumber(t, authed, tournamentId, 4, 5);
  await completeCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const final = await currentRoundStructure(t, authed, tournamentId);
  expect(final.round.roundName).toBe("Finals");
  expect(final.tables).toEqual([new Set([2, 4])]);
  await recordWinByNumber(t, authed, tournamentId, 4, 2);
  const finalRoundId = await completeCurrentRound(authed, tournamentId);

  const board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toEqual({
    kind: "completeTournament",
    ready: true,
    reason: null,
  });
  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  const completedSetup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(completedSetup.tournament.lifecycle).toBe("completed");
  expect(completedSetup.phases[0].phaseStatus).toBe("completed");

  // Standings rank by bracket advancement: champion, finalist, then the
  // semifinal and quarterfinal losers.
  const numberById = await playerNumbersById(t, tournamentId);
  const standings = await authed.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: finalRoundId },
  );
  const ranked = standings.map(
    ({ standing }) => numberById.get(standing.playerId) ?? 0,
  );
  expect(ranked.slice(0, 2)).toEqual([4, 2]);
  expect(new Set(ranked.slice(2, 4))).toEqual(new Set([6, 5]));
  expect(new Set(ranked.slice(4, 6))).toEqual(new Set([3, 1]));
});

test("rewinding a bracket-only round 1 reopens registration and re-pairs the same draw", async () => {
  const t = createConvexTest();
  const { authed, tournamentId } = await createBracketOnlyTournament(t, 6);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const firstDraw = await currentRoundStructure(t, authed, tournamentId);

  // The quarterfinal byes are awarded results written at pairing time, so
  // they don't count as touching the round: the rewind is available.
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const rewoundSetup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(rewoundSetup.tournament.lifecycle).toBe("registration");
  expect(rewoundSetup.phases[0].phaseStatus).toBe("upcoming");

  // The seeding derives from the stored tournament seed, not the moment of
  // pairing, so restarting reproduces the identical draw.
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const secondDraw = await currentRoundStructure(t, authed, tournamentId);
  expect(secondDraw.byePlayers).toEqual(firstDraw.byePlayers);
  expect(secondDraw.tables).toEqual(firstDraw.tables);
});

test("a two-player bracket-only tournament plays a single Finals round", async () => {
  const t = createConvexTest();
  const { authed, tournamentId } = await createBracketOnlyTournament(t, 2);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.phases[0].phaseTotalRounds).toBe(1);
  const final = await currentRoundStructure(t, authed, tournamentId);
  expect(final.round.roundName).toBe("Finals");
  expect(final.byePlayers).toEqual([]);
  expect(final.tables).toEqual([new Set([1, 2])]);

  await recordWinByNumber(t, authed, tournamentId, 1, 2);
  const finalRoundId = await completeCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  const numberById = await playerNumbersById(t, tournamentId);
  const standings = await authed.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: finalRoundId },
  );
  expect(
    standings.map(({ standing }) => numberById.get(standing.playerId)),
  ).toEqual([1, 2]);
});

// Creates an unpublished bracket-only tournament (one single-elimination
// phase) with auto-published pairings and `playerCount` seeded players whose
// tiebreakRandom is their player number — so the pre-play seed order is the
// player numbers descending.
async function createBracketOnlyTournament(
  t: ReturnType<typeof createConvexTest>,
  playerCount: number,
) {
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Bracket Only",
      startDate: Date.now(),
      playerCapacity: playerCount,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "single_elimination",
          phaseRoundMode: "dynamic",
        },
      ],
    },
  );
  await authed.mutation(api.tournaments.lifecycle.updatePairingsAutoPublish, {
    tournamentId,
    autoPublishPairings: true,
  });
  await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `player:${playerNumber}`,
        publicCode: playerNumber,
        email: `player${playerNumber}@example.test`,
        name: `Player ${playerNumber}`,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + playerNumber,
        tiebreakRandom: playerNumber,
        updatedAt: now,
      });
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount:
        tournament.confirmedRegistrationCount + playerCount,
    });
  });
  return { authed, tournamentId };
}

// Registration id → seeded player number (tiebreakRandom carries it).
async function playerNumbersById(
  t: ReturnType<typeof createConvexTest>,
  tournamentId: Id<"tournaments">,
) {
  const entries = await t.run(async (ctx) => {
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .take(64);
    return registrations.map((registration) => ({
      registrationId: registration._id,
      playerNumber: registration.tiebreakRandom,
    }));
  });
  return new Map(
    entries.map(({ registrationId, playerNumber }) => [
      registrationId,
      playerNumber,
    ]),
  );
}

// The current round with its bye players (in listing order) and played
// tables (in table order) expressed as seeded player numbers.
async function currentRoundStructure(
  t: ReturnType<typeof createConvexTest>,
  authed: Authed,
  tournamentId: Id<"tournaments">,
) {
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round");
  }
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  const numberById = await playerNumbersById(t, tournamentId);
  const numberOf = (playerId: Id<"tournamentRegistrations">) => {
    const playerNumber = numberById.get(playerId);
    if (playerNumber === undefined) {
      throw new Error("Unknown player in pairing");
    }
    return playerNumber;
  };
  const byePlayers = pairings
    .filter(({ players }) => players.length === 1)
    .map(({ players }) => numberOf(players[0].playerId));
  const tables = pairings
    .filter(({ players }) => players.length === 2)
    .sort((a, b) => (a.match.tableNumber ?? 0) - (b.match.tableNumber ?? 0))
    .map(
      ({ players }) =>
        new Set(players.map((player) => numberOf(player.playerId))),
    );
  return { round, byePlayers, tables };
}

// Records a required-wins-to-zero win for `winnerNumber` over `loserNumber`
// in the current round.
async function recordWinByNumber(
  t: ReturnType<typeof createConvexTest>,
  authed: Authed,
  tournamentId: Id<"tournaments">,
  winnerNumber: number,
  loserNumber: number,
) {
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round");
  }
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  const numberById = await playerNumbersById(t, tournamentId);
  for (const { match, players } of pairings) {
    if (players.length !== 2) {
      continue;
    }
    const numbers = players.map((player) => numberById.get(player.playerId));
    if (!numbers.includes(winnerNumber) || !numbers.includes(loserNumber)) {
      continue;
    }
    const winner = players[numbers.indexOf(winnerNumber)];
    const loser = players[numbers.indexOf(loserNumber)];
    await authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: winner.playerId,
      playerTwoRegistrationId: loser.playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
    return;
  }
  throw new Error(
    `No match between players ${winnerNumber} and ${loserNumber}`,
  );
}

async function completeCurrentRound(
  authed: Authed,
  tournamentId: Id<"tournaments">,
) {
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round to complete");
  }
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
  return round._id;
}
