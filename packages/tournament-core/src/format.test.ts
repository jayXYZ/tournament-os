import { expect, test } from "vitest";

import {
  isDoubleMatchLoss,
  matchResultKindLabel,
  standingStatusLabel,
} from "./format.ts";

test("a drop or DQ outranks any playoff state", () => {
  expect(
    standingStatusLabel({
      registrationStatus: "dropped",
      playoffStatus: "active",
    }),
  ).toBe("Dropped");
  expect(
    standingStatusLabel({
      registrationStatus: "disqualified",
      playoffStatus: "eliminated",
      eliminatedInRoundNumber: 2,
    }),
  ).toBe("DQ");
});

test("playoff states label active players", () => {
  expect(
    standingStatusLabel({
      registrationStatus: "active",
      playoffStatus: "active",
    }),
  ).toBe("Still active");
  expect(
    standingStatusLabel({ registrationStatus: "active", playoffStatus: "cut" }),
  ).toBe("Missed cut");
});

test("a playoff elimination includes the round when known", () => {
  expect(
    standingStatusLabel({
      registrationStatus: "active",
      playoffStatus: "eliminated",
      eliminatedInRoundNumber: 5,
    }),
  ).toBe("Eliminated R5");
  expect(
    standingStatusLabel({
      registrationStatus: "active",
      playoffStatus: "eliminated",
    }),
  ).toBe("Eliminated");
  expect(
    standingStatusLabel({
      registrationStatus: "active",
      playoffStatus: "eliminated",
      eliminatedInRoundNumber: null,
    }),
  ).toBe("Eliminated");
});

test("a playoff cut outranks an eliminated registration", () => {
  expect(
    standingStatusLabel({
      registrationStatus: "eliminated",
      playoffStatus: "cut",
    }),
  ).toBe("Missed cut");
});

test("an eliminated registration shows through when there is no playoff state", () => {
  expect(standingStatusLabel({ registrationStatus: "eliminated" })).toBe(
    "Eliminated",
  );
  expect(
    standingStatusLabel({
      registrationStatus: "eliminated",
      playoffStatus: "not_started",
    }),
  ).toBe("Eliminated");
});

test("active and unknown players get no marker", () => {
  expect(standingStatusLabel({ registrationStatus: "active" })).toBeNull();
  expect(
    standingStatusLabel({
      registrationStatus: "active",
      playoffStatus: "not_started",
    }),
  ).toBeNull();
  expect(
    standingStatusLabel({ registrationStatus: null, playoffStatus: null }),
  ).toBeNull();
  expect(standingStatusLabel({ registrationStatus: undefined })).toBeNull();
});

test("awarded result kinds the pairing does not already name get a marker", () => {
  expect(matchResultKindLabel("concession")).toBe("Conceded");
  expect(matchResultKindLabel("forfeit")).toBe("Forfeit");
  expect(matchResultKindLabel("no_show")).toBe("No show");
  expect(matchResultKindLabel("dq")).toBe("DQ");
});

test("a double match loss is two players with no match points", () => {
  expect(
    isDoubleMatchLoss([{ matchPointsEarned: 0 }, { matchPointsEarned: 0 }]),
  ).toBe(true);
  // A scoreless draw shares the 0–0 game count but pays a point each.
  expect(
    isDoubleMatchLoss([{ matchPointsEarned: 1 }, { matchPointsEarned: 1 }]),
  ).toBe(false);
  expect(
    isDoubleMatchLoss([{ matchPointsEarned: 3 }, { matchPointsEarned: 0 }]),
  ).toBe(false);
  // No result yet, and a bye's single seat.
  expect(isDoubleMatchLoss([{}, {}])).toBe(false);
  expect(isDoubleMatchLoss([{ matchPointsEarned: 0 }])).toBe(false);
});

test("played, bye, and missing results get no marker", () => {
  expect(matchResultKindLabel("played")).toBeNull();
  // A bye is already named by its opponent-less pairing on every surface,
  // so a marker beside the scoreline would just repeat it.
  expect(matchResultKindLabel("bye")).toBeNull();
  expect(matchResultKindLabel(null)).toBeNull();
  expect(matchResultKindLabel(undefined)).toBeNull();
});
