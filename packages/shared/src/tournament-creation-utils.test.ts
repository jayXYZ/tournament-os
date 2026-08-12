import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addTournamentCreationPhase,
  canMoveTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  moveTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
} from "./tournament-creation-utils.ts";

test("createDefaultTournamentCreationPhase creates a dynamic Swiss phase", () => {
  assert.deepEqual(createDefaultTournamentCreationPhase("phase-1"), {
    id: "phase-1",
    phaseType: "swiss",
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
    bestOf: "3",
    phaseCutoffKind: "none",
    phaseCutoffValue: "8",
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

test("addTournamentCreationPhase inserts a Swiss phase before a playoff", () => {
  const swiss = createDefaultTournamentCreationPhase("phase-1");
  const playoff = {
    ...createDefaultTournamentCreationPhase("playoff"),
    phaseType: "single_elimination" as const,
  };

  assert.deepEqual(addTournamentCreationPhase([swiss, playoff], "phase-2"), [
    swiss,
    createDefaultTournamentCreationPhase("phase-2"),
    playoff,
  ]);
});

test("moveTournamentCreationPhase reorders Swiss phases without moving a playoff", () => {
  const phaseOne = createDefaultTournamentCreationPhase("phase-1");
  const phaseTwo = createDefaultTournamentCreationPhase("phase-2");
  const playoff = {
    ...createDefaultTournamentCreationPhase("playoff"),
    phaseType: "single_elimination" as const,
  };
  const phases = [phaseOne, phaseTwo, playoff];

  assert.equal(canMoveTournamentCreationPhase(phases, "phase-1", 1), true);
  assert.deepEqual(moveTournamentCreationPhase(phases, "phase-1", 1), [
    phaseTwo,
    phaseOne,
    playoff,
  ]);
  assert.equal(canMoveTournamentCreationPhase(phases, "phase-2", 1), false);
  assert.equal(canMoveTournamentCreationPhase(phases, "playoff", -1), false);
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
      ...createDefaultTournamentCreationPhase("phase-2"),
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: "5",
    },
  ];

  // playerMeeting stays absent when false, matching the backend's
  // absent-default field.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseType: "swiss", phaseRoundMode: "dynamic", bestOf: 3 },
    {
      phaseOrder: 2,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: 5,
      bestOf: 3,
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
      bestOf: 3,
      playerMeeting: true,
    },
  ]);
});

test("toTournamentCreationPhasePayload emits a cutoff only where one can apply", () => {
  const phases = [
    {
      ...createDefaultTournamentCreationPhase("phase-1"),
      phaseCutoffKind: "top_X_players" as const,
      phaseCutoffValue: "16",
    },
    {
      ...createDefaultTournamentCreationPhase("phase-2"),
      phaseCutoffKind: "X_points_or_more" as const,
      phaseCutoffValue: "9",
    },
  ];

  // Phase 2 is the final phase, so its configured cutoff is dropped rather
  // than sent to fail backend validation.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "dynamic",
      bestOf: 3,
      phaseCutoff: { kind: "top_X_players", playerCount: 16 },
    },
    { phaseOrder: 2, phaseType: "swiss", phaseRoundMode: "dynamic", bestOf: 3 },
  ]);
});

test("toTournamentCreationPhasePayload drops a cutoff on the phase feeding a playoff", () => {
  const phases = [
    {
      ...createDefaultTournamentCreationPhase("phase-1"),
      phaseCutoffKind: "top_X_players" as const,
    },
    {
      ...createDefaultTournamentCreationPhase("playoff"),
      phaseType: "single_elimination" as const,
    },
  ];

  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseType: "swiss", phaseRoundMode: "dynamic", bestOf: 3 },
    {
      phaseOrder: 2,
      phaseType: "single_elimination",
      phaseRoundMode: "fixed",
      bestOf: 3,
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
      bestOf: 3,
    },
  ]);
});
