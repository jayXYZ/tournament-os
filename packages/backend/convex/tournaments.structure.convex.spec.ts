// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./model/batching";
import { roundHasRecordedResult } from "./model/tournaments";

const schemaSource = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const validatorsSource = readFileSync(
  new URL("./validators.ts", import.meta.url),
  "utf8",
);

const tournamentModules = {
  lifecycle: new URL("./tournaments/lifecycle.ts", import.meta.url),
  registrations: new URL("./tournaments/registrations.ts", import.meta.url),
  rounds: new URL("./tournaments/rounds.ts", import.meta.url),
  testing: new URL("./tournaments/testing.ts", import.meta.url),
};
const modelModules = {
  tournaments: new URL("./model/tournaments.ts", import.meta.url),
  phases: new URL("./model/phases.ts", import.meta.url),
  registrations: new URL("./model/registrations.ts", import.meta.url),
  nextStep: new URL("./model/nextStep.ts", import.meta.url),
  deletion: new URL("./model/deletion.ts", import.meta.url),
  pairing: new URL("./model/pairing.ts", import.meta.url),
  standings: new URL("./model/standings.ts", import.meta.url),
  testing: new URL("./model/testing.ts", import.meta.url),
  random: new URL("./model/random.ts", import.meta.url),
};

test("database I/O batches preserve order and bound concurrency", async () => {
  const inputs = Array.from(
    { length: DATABASE_IO_BATCH_SIZE + 1 },
    (_, index) => index,
  );
  let inFlight = 0;
  let maxInFlight = 0;

  const results = await mapAsyncInBatches(
    inputs,
    DATABASE_IO_BATCH_SIZE,
    async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return input * 2;
    },
  );

  expect(results).toEqual(inputs.map((input) => input * 2));
  expect(maxInFlight).toBe(DATABASE_IO_BATCH_SIZE);
});

test("rewind result detection follows player bye state, not table numbers", () => {
  expect(
    roundHasRecordedResult([
      {
        match: { matchStatus: "completed", tableNumber: 99 },
        players: [{ isBye: true }],
      },
    ]),
  ).toBe(false);
  expect(
    roundHasRecordedResult([
      {
        match: { matchStatus: "completed" },
        players: [{ isBye: false }, { isBye: false }],
      },
    ]),
  ).toBe(true);
});

test("tournament schema includes operational indexes and test config tables", () => {
  expect(schemaSource).toMatch(
    /\.index\("by_tournamentId_and_userId", \["tournamentId", "userId"\]\)/,
  );
  expect(schemaSource).toMatch(
    /\.index\("by_tournamentId_and_status", \["tournamentId", "status"\]\)/,
  );
  expect(schemaSource).toMatch(
    /\.index\("by_userId_and_status", \["userId", "status"\]\)/,
  );
  expect(schemaSource).toMatch(/roundNumber: v\.number\(\)/);
  expect(schemaSource).toMatch(
    /\.index\("by_tournamentPhaseId_and_roundNumber", \[\s*"tournamentPhaseId",\s*"roundNumber",\s*\]\)/,
  );
  expect(schemaSource).toMatch(
    /\.index\("by_tournamentRoundId_and_tableNumber", \[\s*"tournamentRoundId",\s*"tableNumber",\s*\]\)/,
  );
  expect(schemaSource).toMatch(/phaseRoundMode: tournamentPhaseRoundModeValidator/);
  expect(schemaSource).toMatch(
    /phaseTotalRounds: v\.union\(v\.number\(\), v\.null\(\)\)/,
  );
  expect(schemaSource).toMatch(/\.index\("by_playerId", \["playerId"\]\)/);
  expect(schemaSource).toMatch(
    /\.index\("by_tournamentRoundId_and_rank", \[\s*"tournamentRoundId",\s*"rank",?\s*\]\)/,
  );
  expect(schemaSource).toMatch(/tournamentTestConfigs: defineTable/);
  expect(schemaSource).toMatch(/testTournamentPlayers: defineTable/);
});

test("registration statuses exclude payment-only states", () => {
  const registrationValidator = validatorsSource.match(
    /export const tournamentRegistrationStatusValidator = v\.union\(([\s\S]*?)\);/,
  );

  expect(registrationValidator).not.toBeNull();
  expect(registrationValidator![1]).not.toMatch(/"paid"/);
  expect(registrationValidator![1]).not.toMatch(/"unpaid"/);
});

test("tournament domain helpers define Swiss MVP behavior", () => {
  for (const path of Object.values(modelModules)) {
    expect(existsSync(path)).toBe(true);
  }

  const phasesModel = readFileSync(modelModules.phases, "utf8");
  expect(phasesModel).toMatch(/export const SWISS_FORMAT = "swiss"/);
  expect(phasesModel).toMatch(/export function defaultSwissRoundCount/);

  const standingsModel = readFileSync(modelModules.standings, "utf8");
  expect(standingsModel).toMatch(/export function compareStandingRows/);

  const randomModel = readFileSync(modelModules.random, "utf8");
  expect(randomModel).toMatch(/export function createSeededRandom/);

  const testingModel = readFileSync(modelModules.testing, "utf8");
  expect(testingModel).toMatch(/export function simulatedMatchResult/);
});

test("tournament functions expose setup registration operation and test APIs", () => {
  const expectedExports: Record<keyof typeof tournamentModules, string[]> = {
    lifecycle: [
      "listForOrganization",
      "getTournamentSetup",
      "createTournament",
      "createTournamentWithPhases",
      "updateTournamentSetup",
      "updateTournamentPhases",
      "publishTournament",
      "cancelTournament",
      "completeTournament",
    ],
    registrations: [
      "registerSelf",
      "cancelMyRegistration",
      "getMyRegistration",
      "listRegistrations",
      "dropRegistration",
      "reinstateRegistration",
    ],
    rounds: [
      "startTournament",
      "generateNextRound",
      "recordMatchResult",
      "completeRound",
      "getCurrentRound",
      "listRoundPairings",
      "getStandings",
    ],
    testing: [
      "createTestTournament",
      "seedTestPlayers",
      "generateTestRoundResults",
      "advanceTestRound",
      "resetTestTournament",
    ],
  };

  for (const [moduleName, functionNames] of Object.entries(expectedExports)) {
    const path = tournamentModules[moduleName as keyof typeof tournamentModules];
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, "utf8");

    expect(source).not.toMatch(/\.filter\(/);
    expect(source).toMatch(/requireOrganizerAccess|requireActiveMembership/);
    for (const functionName of functionNames) {
      expect(source).toMatch(new RegExp(`export const ${functionName} =`));
    }
  }

  const tournamentsModel = readFileSync(modelModules.tournaments, "utf8");
  expect(tournamentsModel).toMatch(/tournament\.isTestEvent !== true/);

  const testingModel = readFileSync(modelModules.testing, "utf8");
  expect(testingModel).toMatch(/test:\$\{tournamentId\}:player:\$\{playerNumber\}/);
});
