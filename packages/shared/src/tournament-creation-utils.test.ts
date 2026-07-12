import assert from "node:assert/strict";
import test from "node:test";

import {
  addTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
} from "./tournament-creation-utils.ts";

test("createDefaultTournamentCreationPhase creates a dynamic Swiss phase", () => {
  assert.deepEqual(createDefaultTournamentCreationPhase("phase-1"), {
    id: "phase-1",
    phaseType: "swiss",
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

test("removeTournamentCreationPhase preserves a leading Swiss phase", () => {
  const onlyPhase = [createDefaultTournamentCreationPhase("phase-1")];
  const twoPhases = addTournamentCreationPhase(onlyPhase, "phase-2");
  const swissAndPlayoff = [
    createDefaultTournamentCreationPhase("phase-1"),
    {
      ...createDefaultTournamentCreationPhase("playoff"),
      phaseType: "single_elimination" as const,
    },
  ];

  assert.equal(canRemoveTournamentCreationPhase(onlyPhase, "phase-1"), false);
  assert.deepEqual(
    removeTournamentCreationPhase(onlyPhase, "phase-1"),
    onlyPhase,
  );
  assert.deepEqual(removeTournamentCreationPhase(twoPhases, "phase-1"), [
    createDefaultTournamentCreationPhase("phase-2"),
  ]);
  assert.equal(
    canRemoveTournamentCreationPhase(swissAndPlayoff, "phase-1"),
    false,
  );
  assert.deepEqual(
    removeTournamentCreationPhase(swissAndPlayoff, "phase-1"),
    swissAndPlayoff,
  );
  assert.equal(
    canRemoveTournamentCreationPhase(swissAndPlayoff, "playoff"),
    true,
  );
  assert.deepEqual(removeTournamentCreationPhase(swissAndPlayoff, "playoff"), [
    createDefaultTournamentCreationPhase("phase-1"),
  ]);
});

test("toTournamentCreationPhasePayload sends contiguous phase orders", () => {
  const phases = [
    createDefaultTournamentCreationPhase("phase-1"),
    {
      id: "phase-2",
      phaseType: "swiss" as const,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: "5",
      playerMeeting: false,
    },
  ];

  // playerMeeting stays absent when false, matching the backend's
  // absent-default field.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseType: "swiss", phaseRoundMode: "dynamic" },
    {
      phaseOrder: 2,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: 5,
    },
  ]);
});

test("toTournamentCreationPhasePayload emits playerMeeting only when enabled", () => {
  const phases = [
    { ...createDefaultTournamentCreationPhase("phase-1"), playerMeeting: true },
  ];

  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "dynamic",
      playerMeeting: true,
    },
  ]);
});

test("toTournamentCreationPhasePayload fixes a single-elimination phase at three rounds", () => {
  const phase = {
    ...createDefaultTournamentCreationPhase("playoff"),
    phaseType: "single_elimination" as const,
  };

  assert.deepEqual(toTournamentCreationPhasePayload([phase]), [
    {
      phaseOrder: 1,
      phaseType: "single_elimination",
      phaseRoundMode: "fixed",
    },
  ]);
});
