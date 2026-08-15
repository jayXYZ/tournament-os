/// <reference types="vite/client" />

import { expect, test } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import {
  buildSingleEliminationPairings,
  buildSwissPairings,
  type PairingOptions,
  type Pairing,
  type RankedRegistration,
} from "./model/pairing";
import {
  planSingleEliminationPairings,
  singleEliminationRoundName,
} from "./model/singleElimination";

function seededRegistrations(count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        _id: `seed-${index + 1}` as unknown as Id<"tournamentRegistrations">,
      }) as Doc<"tournamentRegistrations">,
  );
}

function bracketKeys(registrations: Doc<"tournamentRegistrations">[]) {
  return buildSingleEliminationPairings(registrations).map((pairing) => [
    pairing.playerOne._id,
    pairing.playerTwo?._id,
  ]);
}

test("an eight-player bracket uses the standard seeding order", () => {
  expect(bracketKeys(seededRegistrations(8))).toEqual([
    ["seed-1", "seed-8"],
    ["seed-4", "seed-5"],
    ["seed-2", "seed-7"],
    ["seed-3", "seed-6"],
  ]);
});

test("smaller power-of-two brackets are standard-seeded too", () => {
  expect(bracketKeys(seededRegistrations(4))).toEqual([
    ["seed-1", "seed-4"],
    ["seed-2", "seed-3"],
  ]);
  expect(bracketKeys(seededRegistrations(2))).toEqual([["seed-1", "seed-2"]]);
});

// A short field plays the smallest power-of-two bracket that fits, with the
// unfilled lowest seats' scheduled opponents — the highest seeds — taking
// first-round byes (CONTEXT.md "Bracket"). An `undefined` second key below is
// such a bye.
test("a short field gives the top seeds first-round byes", () => {
  expect(bracketKeys(seededRegistrations(3))).toEqual([
    ["seed-1", undefined],
    ["seed-2", "seed-3"],
  ]);
  expect(bracketKeys(seededRegistrations(6))).toEqual([
    ["seed-1", undefined],
    ["seed-4", "seed-5"],
    ["seed-2", undefined],
    ["seed-3", "seed-6"],
  ]);
  const fiveOfEight = buildSingleEliminationPairings(seededRegistrations(5));
  expect(
    fiveOfEight.map((pairing) => [
      pairing.playerOne._id,
      pairing.playerTwo?._id,
    ]),
  ).toEqual([
    ["seed-1", undefined],
    ["seed-4", "seed-5"],
    ["seed-2", undefined],
    ["seed-3", undefined],
  ]);
  expect(fiveOfEight.map((pairing) => pairing.isBye)).toEqual([
    true,
    false,
    true,
    true,
  ]);
});

test("a bracket refuses a field of fewer than two players", () => {
  for (const size of [0, 1]) {
    expect(() =>
      buildSingleEliminationPairings(seededRegistrations(size)),
    ).toThrow("at least two seeded players");
  }
});

test("bracket rounds are named from their structural position", () => {
  expect(singleEliminationRoundName(1)).toBe("Finals");
  expect(singleEliminationRoundName(2)).toBe("Semifinals");
  expect(singleEliminationRoundName(3)).toBe("Quarterfinals");
  expect(singleEliminationRoundName(4)).toBe("Round of 16");
  expect(singleEliminationRoundName(5)).toBe("Round of 32");
});

// Minimal registration factory for the walkover planner: only _id and
// participationStatus matter.
function seat(id: string, status: "active" | "dropped" = "active") {
  return {
    _id: id as unknown as Id<"tournamentRegistrations">,
    participationStatus: status,
  } as Doc<"tournamentRegistrations">;
}

function planKeys(pairings: Pairing[]): string[] {
  return pairings.map((pairing) =>
    pairing.isBye
      ? `bye:${pairing.playerOne._id}`
      : `${pairing.playerOne._id}v${pairing.playerTwo?._id}`,
  );
}

test("bracket advancement pairs adjacent live seats", () => {
  expect(
    planKeys(
      planSingleEliminationPairings([
        seat("a"),
        seat("b"),
        seat("c"),
        seat("d"),
      ]),
    ),
  ).toEqual(["avb", "cvd"]);
});

test("a departed seat-holder's scheduled opponent receives a walkover Bye", () => {
  expect(
    planKeys(
      planSingleEliminationPairings([
        seat("a", "dropped"),
        seat("b"),
        seat("c"),
        seat("d", "dropped"),
      ]),
    ),
  ).toEqual(["bye:b", "bye:c"]);
});

test("a seat pair with no live player advances nobody, chaining the walkover", () => {
  // The empty pair produces no match at all; the lone trailing seat is one
  // whose scheduled opponent's seat emptied a round earlier.
  expect(
    planKeys(
      planSingleEliminationPairings([
        seat("a", "dropped"),
        seat("b", "dropped"),
        seat("c"),
        seat("d"),
      ]),
    ),
  ).toEqual(["cvd"]);
  expect(planKeys(planSingleEliminationPairings([seat("c")]))).toEqual([
    "bye:c",
  ]);
  expect(planSingleEliminationPairings([seat("c", "dropped")])).toEqual([]);
});

// Minimal RankedRegistration factory: only _id on the registration
// and the standings/history fields the matcher reads actually matter.
function ranked(
  id: string,
  options: {
    points?: number;
    // Standing position among equals: lower ranks higher, mapped onto the
    // descending tiebreakRandom comparator term.
    position?: number;
    gameWinPct?: number;
    opponents?: string[];
    byeCount?: number;
  } = {},
): RankedRegistration {
  return {
    registration: {
      _id: id as unknown as Id<"tournamentRegistrations">,
    } as Doc<"tournamentRegistrations">,
    matchPoints: options.points ?? 0,
    opponentMatchWinPct: 0,
    gameWinPct: options.gameWinPct ?? 0,
    opponentGameWinPct: 0,
    tiebreakRandom: 1000 - (options.position ?? 0),
    tiebreakId: id,
    opponentIds: new Set(
      (options.opponents ?? []).map(
        (opponent) => opponent as unknown as Id<"tournamentRegistrations">,
      ),
    ),
    byeCount: options.byeCount ?? 0,
  };
}

const POWER_PAIR_FINAL: PairingOptions = {
  seed: 1,
  roundNumber: 4,
  finalRound: true,
  powerPairFinalRound: true,
};

function pairKey(pairing: Pairing): string {
  return [pairing.playerOne._id, pairing.playerTwo?._id]
    .filter(Boolean)
    .sort()
    .join("|");
}

function orderedKeys(pairings: Pairing[]): string[] {
  return pairings.filter((pairing) => !pairing.isBye).map(pairKey);
}

test("avoids a rematch the old greedy pass would have made", () => {
  // C and D have already played. Greedy pairs A-B first, stranding C-D into a
  // rematch; the backtracking matcher pairs A-C and B-D instead.
  const players = [
    ranked("A", { position: 1 }),
    ranked("B", { position: 2 }),
    ranked("C", { position: 3, opponents: ["D"] }),
    ranked("D", { position: 4, opponents: ["C"] }),
  ];

  const pairings = buildSwissPairings(players, POWER_PAIR_FINAL);

  expect(pairings).toHaveLength(2);
  expect(pairings.every((pairing) => !pairing.isBye)).toBe(true);
  expect(orderedKeys(pairings)).not.toContain("C|D");
});

test("forces a float-down rather than repeating a pairing", () => {
  // A has played everyone in its bracket except F, so A must float to F.
  const players = [
    ranked("A", { points: 6, position: 1, opponents: ["B", "C", "D", "E"] }),
    ranked("B", { points: 6, position: 2, opponents: ["A"] }),
    ranked("C", { points: 6, position: 3, opponents: ["A"] }),
    ranked("D", { points: 6, position: 4, opponents: ["A"] }),
    ranked("E", { points: 6, position: 5, opponents: ["A"] }),
    ranked("F", { points: 3, position: 6 }),
  ];

  const pairings = buildSwissPairings(players, POWER_PAIR_FINAL);
  const keys = orderedKeys(pairings);

  expect(keys).toContain("A|F");
  expect(new Set(keys).size).toBe(keys.length);
});

test("gracefully minimizes rematches when none can be avoided", () => {
  // A saturated four-player field (everyone has played everyone): no
  // rematch-free pairing exists, so the matcher must still pair everyone.
  const players = [
    ranked("A", { position: 1, opponents: ["B", "C", "D"] }),
    ranked("B", { position: 2, opponents: ["A", "C", "D"] }),
    ranked("C", { position: 3, opponents: ["A", "B", "D"] }),
    ranked("D", { position: 4, opponents: ["A", "B", "C"] }),
  ];

  const pairings = buildSwissPairings(players, POWER_PAIR_FINAL);

  expect(pairings).toHaveLength(2);
  const ids = pairings.flatMap((pairing) => [
    pairing.playerOne._id,
    pairing.playerTwo?._id,
  ]);
  expect(new Set(ids).size).toBe(4);
});

test("gives the bye to the lowest-ranked player without one", () => {
  // E is lowest by standings but already had a bye, so D floats into the bye.
  const players = [
    ranked("A", { position: 1 }),
    ranked("B", { position: 2 }),
    ranked("C", { position: 3 }),
    ranked("D", { position: 4 }),
    ranked("E", { position: 5, byeCount: 1 }),
  ];

  const pairings = buildSwissPairings(players, {
    seed: 5,
    roundNumber: 2,
    finalRound: false,
    powerPairFinalRound: true,
  });

  const bye = pairings.find((pairing) => pairing.isBye);
  expect(bye?.playerOne._id).toBe("D");
  expect(pairings.filter((pairing) => pairing.isBye)).toHaveLength(1);
});

test("is deterministic for a seed and varies by round", () => {
  const field = () =>
    Array.from({ length: 8 }, (_, index) =>
      ranked(`P${index}`, { position: index + 1 }),
    );
  const options: PairingOptions = {
    seed: 42,
    roundNumber: 1,
    finalRound: false,
    powerPairFinalRound: true,
  };

  const first = orderedKeys(buildSwissPairings(field(), options));
  const repeat = orderedKeys(buildSwissPairings(field(), options));
  const nextRound = orderedKeys(
    buildSwissPairings(field(), { ...options, roundNumber: 2 }),
  );

  expect(repeat).toEqual(first);
  expect(nextRound).not.toEqual(first);
});

test("final-round power pairing makes the top table decisive", () => {
  // Same record, distinct game-win percentages → standings order A,B,C,D.
  const field = () => [
    ranked("A", { points: 6, position: 1, gameWinPct: 0.9 }),
    ranked("B", { points: 6, position: 2, gameWinPct: 0.8 }),
    ranked("C", { points: 6, position: 3, gameWinPct: 0.7 }),
    ranked("D", { points: 6, position: 4, gameWinPct: 0.6 }),
  ];

  const powerPaired = buildSwissPairings(field(), POWER_PAIR_FINAL);
  expect(orderedKeys(powerPaired)).toContain("A|B");

  // With the strict-MTR toggle off, some seed must break the A-B top table,
  // proving the within-bracket randomization actually mixes the bracket.
  const someSeedSplitsTopTwo = Array.from({ length: 50 }, (_, seed) =>
    orderedKeys(
      buildSwissPairings(field(), {
        seed,
        roundNumber: 4,
        finalRound: true,
        powerPairFinalRound: false,
      }),
    ),
  ).some((keys) => !keys.includes("A|B"));
  expect(someSeedSplitsTopTwo).toBe(true);
});
