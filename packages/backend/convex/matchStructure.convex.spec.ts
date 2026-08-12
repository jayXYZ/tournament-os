/// <reference types="vite/client" />

// Match Structure (best-of-X per phase): configuration through the phase
// mutations, and the result-entry and bye behavior it drives. See CONTEXT.md
// "Match Structure" and @tournament-os/shared/match-structure.
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("phase match structure defaults to best of 3 and follows phase edits", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);

  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Structure Event",
      startDate: Date.now() + 86_400_000,
      playerCapacity: 16,
      format: "modern",
      phases: [
        { phaseOrder: 1, phaseRoundMode: "dynamic" },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
          bestOf: 5,
        },
      ],
    },
  );

  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.phases.map((phase) => phase.bestOf)).toEqual([3, 5]);

  // Full-replace semantics like the rest of the phase editor payload: an
  // omitted bestOf resets to the default, so the editor always sends it.
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: setup.phases[0]._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
        bestOf: 1,
      },
      {
        phaseId: setup.phases[1]._id,
        phaseOrder: 2,
        phaseType: "single_elimination",
        phaseRoundMode: "fixed",
      },
    ],
  });
  const updated = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(updated.phases.map((phase) => phase.bestOf)).toEqual([1, 3]);

  // Unsupported structures never reach the phase model: the argument
  // validator only admits 1, 3, and 5.
  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
      tournamentId,
      phases: [
        {
          phaseId: setup.phases[0]._id,
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
          bestOf: 2 as unknown as 1,
        },
      ],
    }),
  ).rejects.toThrow();
});

// Starts a test tournament whose only Swiss phase uses the given structure,
// returning the in-progress first round's pairings.
async function startStructuredTournament(
  t: ReturnType<typeof createConvexTest>,
  organizationId: Id<"organizations">,
  options: { bestOf: 1 | 3 | 5; dummyPlayerCount: number; seed: number },
) {
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: `Best of ${options.bestOf} Event`,
      dummyPlayerCount: options.dummyPlayerCount,
      roundsToGenerate: 2,
      seed: options.seed,
      autoStart: false,
    },
  );
  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: setup.phases[0]._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 2,
        bestOf: options.bestOf,
      },
    ],
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
  );
  return { organizer, tournamentId, round: round!, pairings };
}

test("best-of-1 rounds award 1–0 byes and bound result entry at one game", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t, 1_000);
  const { organizer, pairings } = await startStructuredTournament(
    t,
    organizationId,
    { bestOf: 1, dummyPlayerCount: 5, seed: 11 },
  );

  // A Bye is an Awarded Result at the structure's required game wins.
  const byeRow = pairings.find(({ players }) =>
    players.some((player) => player.isBye),
  );
  expect(byeRow).toBeDefined();
  expect(byeRow!.players[0].gameWins).toBe(1);
  expect(byeRow!.players[0].gameLosses).toBe(0);
  expect(byeRow!.players[0].matchPointsEarned).toBe(3);

  const [first, second] = pairings.filter(
    ({ players }) => players.length === 2,
  );
  const resultArgs = (row: typeof first) => ({
    matchId: row.match._id,
    playerOneRegistrationId: row.players[0].playerId,
    playerTwoRegistrationId: row.players[1].playerId,
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      ...resultArgs(first),
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    }),
  ).rejects.toThrow("A best-of-1 match is won at 1 game win");
  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      ...resultArgs(first),
      playerOneGameWins: 1,
      playerTwoGameWins: 1,
    }),
  ).rejects.toThrow("Game wins can total at most 1 in a best-of-1 match");

  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(first),
    playerOneGameWins: 1,
    playerTwoGameWins: 0,
  });
  // A 0–0 time-out draw is a valid Swiss result even in best of 1.
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(second),
    playerOneGameWins: 0,
    playerTwoGameWins: 0,
  });
});

test("best-of-5 rounds accept results up to three wins and five games", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t, 2_000);
  const { organizer, pairings } = await startStructuredTournament(
    t,
    organizationId,
    { bestOf: 5, dummyPlayerCount: 4, seed: 23 },
  );

  const [first, second] = pairings;
  const resultArgs = (row: typeof first) => ({
    matchId: row.match._id,
    playerOneRegistrationId: row.players[0].playerId,
    playerTwoRegistrationId: row.players[1].playerId,
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      ...resultArgs(first),
      playerOneGameWins: 4,
      playerTwoGameWins: 0,
    }),
  ).rejects.toThrow("A best-of-5 match is won at 3 game wins");
  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      ...resultArgs(first),
      playerOneGameWins: 3,
      playerTwoGameWins: 3,
    }),
  ).rejects.toThrow("Game wins can total at most 5 in a best-of-5 match");

  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(first),
    playerOneGameWins: 3,
    playerTwoGameWins: 2,
  });
  // A 2–2 time-out draw fits inside five games.
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(second),
    playerOneGameWins: 2,
    playerTwoGameWins: 2,
  });
});
