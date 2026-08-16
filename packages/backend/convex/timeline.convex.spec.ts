/// <reference types="vite/client" />

// The phase timeline projection: the engine's one statement of the
// tournament's expected round layout. Round numbers are global across
// phases, a phase's planned count comes from its configured total (its real
// rounds if they exceed it) or a finished phase's actual rounds, and an
// unresolved dynamic phase makes everything after it unnumberable until it
// finishes. Timeline clients render these numbers; they never re-derive
// them.
import { expect, test } from "vitest";

import { phaseTimelines } from "./model/phases";

type Status = "upcoming" | "in_progress" | "completed" | "cancelled";

function board(
  phaseStatus: Status,
  phaseTotalRounds: number | null,
  roundNumbers: number[] = [],
) {
  return {
    phase: { phaseStatus, phaseTotalRounds },
    rounds: roundNumbers.map((roundNumber) => ({ roundNumber })),
  };
}

test("a fixed phase plans its configured total from round one", () => {
  expect(phaseTimelines([board("upcoming", 3)])).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 3 },
  ]);
  expect(phaseTimelines([board("in_progress", 3, [1, 2])])).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 3 },
  ]);
});

test("real rounds beyond the configured total extend the plan", () => {
  expect(phaseTimelines([board("in_progress", 3, [1, 2, 3, 4])])).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 4 },
  ]);
});

test("a later phase starts after the rounds planned before it", () => {
  expect(
    phaseTimelines([
      board("completed", 3, [1, 2, 3]),
      board("upcoming", 2),
      board("upcoming", 1),
    ]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 3 },
    { startRoundNumber: 4, plannedRoundCount: 2 },
    { startRoundNumber: 6, plannedRoundCount: 1 },
  ]);
  // The projection also spans a phase still being played.
  expect(
    phaseTimelines([board("in_progress", 3, [1]), board("upcoming", 2)]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 3 },
    { startRoundNumber: 4, plannedRoundCount: 2 },
  ]);
});

test("a phase's real first round wins over the projection", () => {
  expect(
    phaseTimelines([
      board("completed", 3, [1, 2, 3, 4]),
      board("in_progress", 2, [5]),
    ]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 4 },
    { startRoundNumber: 5, plannedRoundCount: 2 },
  ]);
});

test("an unresolved dynamic phase unnumbers everything after it", () => {
  expect(
    phaseTimelines([
      board("in_progress", null, [1, 2]),
      board("upcoming", 2),
      board("upcoming", null),
    ]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: null },
    { startRoundNumber: null, plannedRoundCount: 2 },
    { startRoundNumber: null, plannedRoundCount: null },
  ]);
});

test("a finished dynamic phase's round count is final", () => {
  expect(
    phaseTimelines([board("completed", null, [1, 2]), board("upcoming", 2)]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 2 },
    { startRoundNumber: 3, plannedRoundCount: 2 },
  ]);
  // A cancelled phase is finished too: whatever rounds exist are all there
  // will be.
  expect(
    phaseTimelines([board("cancelled", null, [1]), board("upcoming", 2)]),
  ).toEqual([
    { startRoundNumber: 1, plannedRoundCount: 1 },
    { startRoundNumber: 2, plannedRoundCount: 2 },
  ]);
});

test("no phases means no timeline", () => {
  expect(phaseTimelines([])).toEqual([]);
});
