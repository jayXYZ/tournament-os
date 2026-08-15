import { expect, test } from "vitest";

import { standingStatusLabel } from "./format.ts";

const DQ = { disqualifiedLabel: "DQ" };

test("a drop or DQ outranks any playoff state", () => {
  expect(
    standingStatusLabel(
      { registrationStatus: "dropped", playoffStatus: "active" },
      DQ,
    ),
  ).toBe("Dropped");
  expect(
    standingStatusLabel(
      {
        registrationStatus: "disqualified",
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: 2,
      },
      DQ,
    ),
  ).toBe("DQ");
});

test("the disqualified wording comes from the caller", () => {
  // Players see "Dropped" for a DQ; organizers see "DQ".
  expect(
    standingStatusLabel(
      { registrationStatus: "disqualified" },
      { disqualifiedLabel: "Dropped" },
    ),
  ).toBe("Dropped");
});

test("playoff states label active players", () => {
  expect(
    standingStatusLabel(
      { registrationStatus: "active", playoffStatus: "active" },
      DQ,
    ),
  ).toBe("Still active");
  expect(
    standingStatusLabel(
      { registrationStatus: "active", playoffStatus: "cut" },
      DQ,
    ),
  ).toBe("Missed cut");
});

test("a playoff elimination includes the round when known", () => {
  expect(
    standingStatusLabel(
      {
        registrationStatus: "active",
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: 5,
      },
      DQ,
    ),
  ).toBe("Eliminated R5");
  expect(
    standingStatusLabel(
      { registrationStatus: "active", playoffStatus: "eliminated" },
      DQ,
    ),
  ).toBe("Eliminated");
  expect(
    standingStatusLabel(
      {
        registrationStatus: "active",
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: null,
      },
      DQ,
    ),
  ).toBe("Eliminated");
});

test("a playoff cut outranks an eliminated registration", () => {
  expect(
    standingStatusLabel(
      { registrationStatus: "eliminated", playoffStatus: "cut" },
      DQ,
    ),
  ).toBe("Missed cut");
});

test("an eliminated registration shows through when there is no playoff state", () => {
  expect(standingStatusLabel({ registrationStatus: "eliminated" }, DQ)).toBe(
    "Eliminated",
  );
  expect(
    standingStatusLabel(
      { registrationStatus: "eliminated", playoffStatus: "not_started" },
      DQ,
    ),
  ).toBe("Eliminated");
});

test("active and unknown players get no marker", () => {
  expect(standingStatusLabel({ registrationStatus: "active" }, DQ)).toBeNull();
  expect(
    standingStatusLabel(
      { registrationStatus: "active", playoffStatus: "not_started" },
      DQ,
    ),
  ).toBeNull();
  expect(
    standingStatusLabel({ registrationStatus: null, playoffStatus: null }, DQ),
  ).toBeNull();
  expect(standingStatusLabel({ registrationStatus: undefined }, DQ)).toBeNull();
});
