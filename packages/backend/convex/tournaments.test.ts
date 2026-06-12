import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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
  pairing: new URL("./model/pairing.ts", import.meta.url),
  standings: new URL("./model/standings.ts", import.meta.url),
  testing: new URL("./model/testing.ts", import.meta.url),
};

test("tournament schema includes operational indexes and test config tables", () => {
  assert.match(
    schemaSource,
    /\.index\("by_tournamentId_and_userId", \["tournamentId", "userId"\]\)/,
  );
  assert.match(
    schemaSource,
    /\.index\("by_tournamentId_and_status", \["tournamentId", "status"\]\)/,
  );
  assert.match(
    schemaSource,
    /\.index\("by_userId_and_status", \["userId", "status"\]\)/,
  );
  assert.match(schemaSource, /roundNumber: v\.number\(\)/);
  assert.match(
    schemaSource,
    /\.index\("by_tournamentPhaseId_and_roundNumber", \[\s*"tournamentPhaseId",\s*"roundNumber",\s*\]\)/,
  );
  assert.match(
    schemaSource,
    /\.index\("by_tournamentRoundId_and_tableNumber", \[\s*"tournamentRoundId",\s*"tableNumber",\s*\]\)/,
  );
  assert.match(schemaSource, /phaseRoundMode: tournamentPhaseRoundModeValidator/);
  assert.match(
    schemaSource,
    /phaseTotalRounds: v\.union\(v\.number\(\), v\.null\(\)\)/,
  );
  assert.match(
    schemaSource,
    /\.index\("by_playerId", \["playerId"\]\)/,
  );
  assert.match(
    schemaSource,
    /\.index\("by_tournamentRoundId_and_rank", \[\s*"tournamentRoundId",\s*"rank",?\s*\]\)/,
  );
  assert.match(schemaSource, /tournamentTestConfigs: defineTable/);
  assert.match(schemaSource, /testTournamentPlayers: defineTable/);
});

test("registration statuses exclude payment-only states", () => {
  const registrationValidator = validatorsSource.match(
    /export const tournamentRegistrationStatusValidator = v\.union\(([\s\S]*?)\);/,
  );

  assert.ok(registrationValidator);
  assert.doesNotMatch(registrationValidator[1], /"paid"/);
  assert.doesNotMatch(registrationValidator[1], /"unpaid"/);
});

test("tournament domain helpers define Swiss MVP behavior", () => {
  for (const path of Object.values(modelModules)) {
    assert.equal(existsSync(path), true);
  }

  const tournamentsModel = readFileSync(modelModules.tournaments, "utf8");
  assert.match(tournamentsModel, /export const SWISS_FORMAT = "swiss"/);
  assert.match(tournamentsModel, /export function defaultSwissRoundCount/);

  const standingsModel = readFileSync(modelModules.standings, "utf8");
  assert.match(standingsModel, /export function compareStandingRows/);

  const testingModel = readFileSync(modelModules.testing, "utf8");
  assert.match(testingModel, /export function createSeededRandom/);
  assert.match(testingModel, /export function simulatedMatchResult/);
});

test("tournament functions expose setup registration operation and test APIs", () => {
  const expectedExports: Record<keyof typeof tournamentModules, string[]> = {
    lifecycle: [
      "listForOrganization",
      "getTournamentSetup",
      "createTournament",
      "createTournamentWithPhases",
      "updateTournamentSetup",
      "configureSwissPhase",
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
    assert.equal(existsSync(path), true);
    const source = readFileSync(path, "utf8");

    assert.doesNotMatch(source, /\.filter\(/);
    assert.match(source, /requireOrganizerAccess|requireActiveMembership/);
    for (const functionName of functionNames) {
      assert.match(source, new RegExp(`export const ${functionName} =`));
    }
  }

  const tournamentsModel = readFileSync(modelModules.tournaments, "utf8");
  assert.match(tournamentsModel, /tournament\.isTestEvent !== true/);

  const testingModel = readFileSync(modelModules.testing, "utf8");
  assert.match(testingModel, /test:\$\{tournamentId\}:player:\$\{playerNumber\}/);
});
