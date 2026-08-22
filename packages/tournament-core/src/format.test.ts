import { expect, test } from "vitest";

import { matchResultKindLabel, standingStatusLabel } from "./format.ts";

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

test("every awarded result kind gets a marker", () => {
  expect(matchResultKindLabel("concession")).toBe("Conceded");
  expect(matchResultKindLabel("bye")).toBe("Bye");
  expect(matchResultKindLabel("forfeit")).toBe("Forfeit");
  expect(matchResultKindLabel("no_show")).toBe("No show");
  expect(matchResultKindLabel("dq")).toBe("DQ");
});

test("a played result and a missing result get no marker", () => {
  expect(matchResultKindLabel("played")).toBeNull();
  expect(matchResultKindLabel(null)).toBeNull();
  expect(matchResultKindLabel(undefined)).toBeNull();
});
