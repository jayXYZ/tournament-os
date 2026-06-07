import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const validatorsSource = readFileSync(
  new URL("./validators.ts", import.meta.url),
  "utf8",
);

const tournamentsPath = new URL("./tournaments.ts", import.meta.url);
const tournamentUtilsPath = new URL("./tournamentUtils.ts", import.meta.url);

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
  assert.equal(existsSync(tournamentUtilsPath), true);
  const source = readFileSync(tournamentUtilsPath, "utf8");

  assert.match(source, /export const SWISS_FORMAT = "swiss"/);
  assert.match(source, /export function defaultSwissRoundCount/);
  assert.match(source, /export function createSeededRandom/);
  assert.match(source, /export function compareStandingRows/);
  assert.match(source, /export function simulatedMatchResult/);
});

test("tournament functions expose setup registration operation and test APIs", () => {
  assert.equal(existsSync(tournamentsPath), true);
  const source = readFileSync(tournamentsPath, "utf8");

  for (const functionName of [
    "listForOrganization",
    "getTournamentSetup",
    "createTournament",
    "updateTournamentSetup",
    "configureSwissPhase",
    "publishTournament",
    "cancelTournament",
    "registerSelf",
    "cancelMyRegistration",
    "getMyRegistration",
    "listRegistrations",
    "dropRegistration",
    "reinstateRegistration",
    "startTournament",
    "generateNextRound",
    "recordMatchResult",
    "completeRound",
    "getCurrentRound",
    "listRoundPairings",
    "getStandings",
    "completeTournament",
    "createTestTournament",
    "seedTestPlayers",
    "generateTestRoundResults",
    "advanceTestRound",
    "resetTestTournament",
  ]) {
    assert.match(source, new RegExp(`export const ${functionName} =`));
  }

  assert.doesNotMatch(source, /\.filter\(/);
  assert.match(source, /requireOrganizerAccess/);
  assert.match(source, /tournament\.isTestEvent !== true/);
  assert.match(source, /test:\$\{tournamentId\}:player:\$\{playerNumber\}/);
});
