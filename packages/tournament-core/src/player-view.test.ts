import { expect, test } from "vitest";

import {
  describeCurrentMatch,
  describeHeaderBadge,
  reportAction,
} from "./player-view.ts";
import type { MyActiveMatch, MyCurrentMatch } from "./types.ts";

// The union carries branded Id types from the generated api, so fixtures are
// built as plain shapes and cast — the presenter only reads fields.
const base = {
  tournament: { name: "Test Open", lifecycle: "in_progress" },
  myRegistrationStatus: "active",
  myRegistrationId: "reg-me",
};

const round = {
  roundNumber: 2,
  roundName: "Round 2",
  roundStatus: "in_progress",
  isFinalRound: false,
};

function currentMatch(shape: Record<string, unknown>): MyCurrentMatch {
  return { ...base, ...shape } as unknown as MyCurrentMatch;
}

function activeMatch(overrides: {
  match?: Record<string, unknown>;
  me?: Record<string, unknown>;
  opponent?: Record<string, unknown> | null;
  round?: Record<string, unknown>;
}): MyActiveMatch {
  return currentMatch({
    kind: "match",
    round: { ...round, ...overrides.round },
    match: {
      _id: "match-1",
      tableNumber: 4,
      matchStatus: "completed",
      reportedByRegistrationId: null,
      currentResultKind: "played",
      bestOf: 3,
      ...overrides.match,
    },
    me: {
      registrationId: "reg-me",
      gameWins: 2,
      gameLosses: 1,
      gameDraws: 0,
      isBye: false,
      outcome: "win",
      ...overrides.me,
    },
    opponent:
      overrides.opponent === undefined
        ? { registrationId: "reg-them", name: "Alice", avatarUrl: null }
        : overrides.opponent,
  }) as MyActiveMatch;
}

test("undefined describes as loading", () => {
  expect(describeCurrentMatch(undefined)).toEqual({ kind: "loading" });
});

test("waiting states describe as status with the wait copy", () => {
  expect(describeCurrentMatch(currentMatch({ kind: "not_started" }))).toEqual({
    kind: "status",
    icon: "hourglass",
    title: "Waiting for round one",
    body: "Pairings will appear here as soon as the organizer starts the tournament.",
  });
  expect(
    describeCurrentMatch(currentMatch({ kind: "pairings_pending", round })),
  ).toMatchObject({
    kind: "status",
    title: "Round 2 pairings pending",
  });
});

test("between rounds copy sends the final round to standings", () => {
  const ongoing = describeCurrentMatch(
    currentMatch({ kind: "between_rounds", round }),
  );
  expect(ongoing).toMatchObject({
    kind: "status",
    title: "Round 2 complete",
    body: "Hang tight — the organizer is preparing the next round's pairings.",
  });
  const final = describeCurrentMatch(
    currentMatch({
      kind: "between_rounds",
      round: { ...round, isFinalRound: true },
    }),
  );
  expect(final).toMatchObject({
    body: "That was the final round. Check the standings tab for the final results.",
  });
});

test("a dropped player sees dropped copy, never a promise of pairings", () => {
  expect(
    describeCurrentMatch(
      currentMatch({
        kind: "no_match",
        myRegistrationStatus: "dropped",
        round,
      }),
    ),
  ).toMatchObject({
    body: "You have dropped from this tournament, so you are no longer paired.",
  });
  expect(
    describeCurrentMatch(
      currentMatch({
        kind: "player_meeting",
        myRegistrationStatus: "dropped",
        meeting: { phaseName: "Phase 1", tableNumber: 1, seatmateName: null },
      }),
    ),
  ).toMatchObject({ kind: "status", title: "No seat for the player meeting" });
});

test("a meeting seat describes as a card with table and seatmate", () => {
  const seated = describeCurrentMatch(
    currentMatch({
      kind: "player_meeting",
      meeting: { phaseName: "Phase 1", tableNumber: 3, seatmateName: "Bob" },
    }),
  );
  expect(seated).toMatchObject({
    kind: "card",
    label: "Player meeting",
    title: "Table 3",
    subtitle: "with Bob",
    action: null,
  });
  const unseated = describeCurrentMatch(
    currentMatch({
      kind: "player_meeting",
      meeting: { phaseName: "Phase 1", tableNumber: null, seatmateName: null },
    }),
  );
  expect(unseated).toMatchObject({
    title: "See the organizer for your seat",
    subtitle: null,
  });
});

test("a bye shows the award and offers no reporting", () => {
  const description = describeCurrentMatch(
    activeMatch({ me: { isBye: true }, opponent: null }),
  );
  expect(description).toMatchObject({
    kind: "card",
    title: "You have a bye",
    scoreline: null,
    action: null,
  });
});

test("an upcoming match carries the report action payload", () => {
  const description = describeCurrentMatch(
    activeMatch({
      match: { matchStatus: "upcoming", currentResultKind: null },
      me: { gameWins: null, gameLosses: null, gameDraws: null, outcome: null },
    }),
  );
  expect(description).toMatchObject({
    kind: "card",
    label: "Round 2",
    title: "Table 4",
    subtitle: "vs Alice",
    action: {
      kind: "report",
      matchId: "match-1",
      bestOf: 3,
      opponentName: "Alice",
    },
  });
});

test("the final round is flagged in the card label", () => {
  const description = describeCurrentMatch(
    activeMatch({ round: { isFinalRound: true } }),
  );
  expect(description).toMatchObject({ label: "Round 2 · Final round" });
});

test("the scoreline reads the stored outcome, not the game counts", () => {
  // A double loss is indistinguishable from a draw by counts alone.
  const doubleLoss = describeCurrentMatch(
    activeMatch({ me: { gameWins: 0, gameLosses: 0, outcome: "loss" } }),
  );
  expect(doubleLoss).toMatchObject({ scoreline: "You lose 0–0" });
  // A completed match missing its revision falls back to the counts.
  const fallback = describeCurrentMatch(
    activeMatch({ me: { gameWins: 1, gameLosses: 2, outcome: null } }),
  );
  expect(fallback).toMatchObject({ scoreline: "You lose 1–2" });
});

test("result provenance: concession outranks the reporter branches", () => {
  const conceded = describeCurrentMatch(
    activeMatch({
      match: { currentResultKind: "concession" },
      me: { gameWins: 0, gameLosses: 2, outcome: "loss" },
    }),
  );
  expect(conceded).toMatchObject({
    badge: { label: "You conceded", tone: "secondary" },
  });
  const opponentConceded = describeCurrentMatch(
    activeMatch({
      match: { currentResultKind: "concession" },
      me: { gameWins: 2, gameLosses: 0, outcome: "win" },
    }),
  );
  expect(opponentConceded).toMatchObject({
    badge: { label: "Opponent conceded", tone: "secondary" },
  });
});

test("result provenance: reporter, then organizer fallback", () => {
  const mine = describeCurrentMatch(
    activeMatch({ match: { reportedByRegistrationId: "reg-me" } }),
  );
  expect(mine).toMatchObject({
    badge: { label: "Reported by you", tone: "outline" },
  });
  const theirs = describeCurrentMatch(
    activeMatch({ match: { reportedByRegistrationId: "reg-them" } }),
  );
  expect(theirs).toMatchObject({
    badge: { label: "Reported by opponent", tone: "outline" },
  });
  const organizer = describeCurrentMatch(activeMatch({}));
  expect(organizer).toMatchObject({
    badge: { label: "Recorded by organizer", tone: "secondary" },
    note: null,
  });
});

test("reportAction is null unless an upcoming two-sided match is unreported", () => {
  expect(reportAction(undefined)).toBeNull();
  expect(reportAction(currentMatch({ kind: "not_started" }))).toBeNull();
  expect(
    reportAction(activeMatch({ match: { matchStatus: "completed" } })),
  ).toBeNull();
  expect(
    reportAction(
      activeMatch({ match: { matchStatus: "upcoming" }, me: { isBye: true } }),
    ),
  ).toBeNull();
  expect(
    reportAction(
      activeMatch({ match: { matchStatus: "upcoming" }, opponent: null }),
    ),
  ).toMatchObject({ kind: "report", opponentName: "Opponent" });
});

test("the header badge ladder: dropped beats completed beats round state", () => {
  expect(describeHeaderBadge(undefined)).toBeNull();
  expect(
    describeHeaderBadge(
      currentMatch({
        kind: "match",
        myRegistrationStatus: "dropped",
        tournament: { ...base.tournament, lifecycle: "completed" },
        round,
      }),
    ),
  ).toEqual({ label: "Dropped", tone: "destructive" });
  expect(
    describeHeaderBadge(
      currentMatch({
        kind: "between_rounds",
        tournament: { ...base.tournament, lifecycle: "completed" },
        round,
      }),
    ),
  ).toEqual({ label: "Completed", tone: "secondary" });
  expect(describeHeaderBadge(currentMatch({ kind: "not_started" }))).toEqual({
    label: "Not started",
    tone: "outline",
  });
  expect(describeHeaderBadge(activeMatch({}))).toEqual({
    label: "Round 2",
    tone: "default",
  });
  expect(
    describeHeaderBadge(
      currentMatch({
        kind: "player_meeting",
        meeting: { phaseName: "Phase 1", tableNumber: 1, seatmateName: null },
      }),
    ),
  ).toBeNull();
});
