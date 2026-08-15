import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addTournamentCreationPhase,
  canMoveTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  moveTournamentCreationPhase,
  removeTournamentCreationPhase,
  setTournamentCreationPhaseType,
  toTournamentCreationPhasePayload,
  type TournamentCreationPhaseForm,
} from "./tournament-creation-utils.ts";

// A phase newly put in front of a playoff gets the default top-8 cut
// pre-filled in place of its untouched "none" (see withPlayoffCutDefaults);
// an explicit "No cut" on a phase already feeding the playoff is kept.
function withDefaultPlayoffCut(phase: TournamentCreationPhaseForm) {
  return {
    ...phase,
    phaseCutoffKind: "top_X_players" as const,
    phaseCutoffValue: "8",
  };
}

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
    withDefaultPlayoffCut(createDefaultTournamentCreationPhase("phase-2")),
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
    withDefaultPlayoffCut(phaseOne),
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
  // absent-default field; a phase with a following phase states its "none"
  // cut as an explicit null.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "dynamic",
      bestOf: 3,
      phaseCutoff: null,
    },
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

test("toTournamentCreationPhasePayload sends the cut feeding a playoff", () => {
  const phases = [
    {
      ...createDefaultTournamentCreationPhase("phase-1"),
      phaseCutoffKind: "top_X_players" as const,
      phaseCutoffValue: "4",
    },
    {
      ...createDefaultTournamentCreationPhase("playoff"),
      phaseType: "single_elimination" as const,
    },
  ];

  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "dynamic",
      bestOf: 3,
      phaseCutoff: { kind: "top_X_players", playerCount: 4 },
    },
    {
      phaseOrder: 2,
      phaseType: "single_elimination",
      phaseRoundMode: "fixed",
      bestOf: 3,
    },
  ]);
});

test("toTournamentCreationPhasePayload sends an explicit no-cut feeding a playoff", () => {
  const phases = [
    createDefaultTournamentCreationPhase("phase-1"),
    {
      ...createDefaultTournamentCreationPhase("playoff"),
      phaseType: "single_elimination" as const,
    },
  ];

  // An omitted cut would be defaulted to top-8 by the backend, so a form
  // showing "No cut" must send the null explicitly.
  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "dynamic",
      bestOf: 3,
      phaseCutoff: null,
    },
    {
      phaseOrder: 2,
      phaseType: "single_elimination",
      phaseRoundMode: "fixed",
      bestOf: 3,
    },
  ]);
});

test("an explicit no-cut on the playoff feeder survives unrelated structural edits", () => {
  const phaseOne = createDefaultTournamentCreationPhase("phase-1");
  const phaseTwo = createDefaultTournamentCreationPhase("phase-2");
  // Feeds the playoff and explicitly keeps "none" — the organizer's choice.
  const feeder = createDefaultTournamentCreationPhase("phase-3");
  const playoff = {
    ...createDefaultTournamentCreationPhase("playoff"),
    phaseType: "single_elimination" as const,
  };
  const phases = [phaseOne, phaseTwo, feeder, playoff];

  // Reordering the earlier Swiss phases leaves the feeder feeding the
  // playoff before and after, so its "none" is not upgraded to top-8.
  assert.deepEqual(moveTournamentCreationPhase(phases, "phase-1", 1), [
    phaseTwo,
    phaseOne,
    feeder,
    playoff,
  ]);
});

test("setTournamentCreationPhaseType defaults the feeding phase's cut to top-8", () => {
  const phases = [
    createDefaultTournamentCreationPhase("phase-1"),
    { ...createDefaultTournamentCreationPhase("phase-2"), playerMeeting: true },
  ];

  assert.deepEqual(
    setTournamentCreationPhaseType(phases, "phase-2", "single_elimination"),
    [
      withDefaultPlayoffCut(createDefaultTournamentCreationPhase("phase-1")),
      {
        ...createDefaultTournamentCreationPhase("phase-2"),
        phaseType: "single_elimination",
        phaseRoundMode: "fixed",
        playerMeeting: false,
      },
    ],
  );
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
