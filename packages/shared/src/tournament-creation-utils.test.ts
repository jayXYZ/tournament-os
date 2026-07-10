import assert from "node:assert/strict";
import test from "node:test";

import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
} from "./tournament-creation-utils.ts";

test("createDefaultTournamentCreationPhase creates a dynamic Swiss phase", () => {
  assert.deepEqual(createDefaultTournamentCreationPhase("phase-1"), {
    id: "phase-1",
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
    playerMeeting: false,
  });
});

test("addTournamentCreationPhase appends a dynamic phase", () => {
  const phases = [createDefaultTournamentCreationPhase("phase-1")];

  assert.deepEqual(addTournamentCreationPhase(phases, "phase-2"), [
    createDefaultTournamentCreationPhase("phase-1"),
    createDefaultTournamentCreationPhase("phase-2"),
  ]);
});

test("removeTournamentCreationPhase keeps one required phase", () => {
  const onlyPhase = [createDefaultTournamentCreationPhase("phase-1")];
  const twoPhases = addTournamentCreationPhase(onlyPhase, "phase-2");

  assert.deepEqual(removeTournamentCreationPhase(onlyPhase, "phase-1"), onlyPhase);
  assert.deepEqual(removeTournamentCreationPhase(twoPhases, "phase-1"), [
    createDefaultTournamentCreationPhase("phase-2"),
  ]);
});

test("toTournamentCreationPhasePayload sends contiguous phase orders", () => {
  const phases = [
    createDefaultTournamentCreationPhase("phase-1"),
    {
      id: "phase-2",
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: "5",
      playerMeeting: false,
    },
  ];

  // playerMeeting stays absent when false, matching the backend's
  // absent-default field.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseRoundMode: "dynamic" },
    { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 5 },
  ]);
});

test("toTournamentCreationPhasePayload emits playerMeeting only when enabled", () => {
  const phases = [
    { ...createDefaultTournamentCreationPhase("phase-1"), playerMeeting: true },
  ];

  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
  ]);
});
