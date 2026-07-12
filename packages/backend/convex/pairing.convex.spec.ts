/// <reference types="vite/client" />

import { expect, test } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import {
  buildSwissPairings,
  buildTopEightSingleEliminationPairings,
  type PairingOptions,
  type Pairing,
  type RankedRegistration,
} from "./model/pairing";

test("top-eight bracket uses tournament seeding order", () => {
  const registrations = Array.from(
    { length: 8 },
    (_, index) =>
      ({
        _id: `seed-${index + 1}` as unknown as Id<"tournamentRegistrations">,
      }) as Doc<"tournamentRegistrations">,
  );

  expect(
    buildTopEightSingleEliminationPairings(registrations).map((pairing) => [
      pairing.playerOne._id,
      pairing.playerTwo?._id,
    ]),
  ).toEqual([
    ["seed-1", "seed-8"],
    ["seed-4", "seed-5"],
    ["seed-2", "seed-7"],
    ["seed-3", "seed-6"],
  ]);
});

// Minimal RankedRegistration factory: only _id/createdAt on the registration
// and the standings/history fields the matcher reads actually matter.
function ranked(
  id: string,
  options: {
    points?: number;
    createdAt?: number;
    gameWinPct?: number;
    opponents?: string[];
    hasHadBye?: boolean;
  } = {},
): RankedRegistration {
  return {
    registration: {
      _id: id as unknown as Id<"tournamentRegistrations">,
      createdAt: options.createdAt ?? 0,
    } as Doc<"tournamentRegistrations">,
    matchPoints: options.points ?? 0,
    opponentMatchWinPct: 0,
    gameWinPct: options.gameWinPct ?? 0,
    opponentGameWinPct: 0,
    createdAt: options.createdAt ?? 0,
    opponentIds: new Set(
      (options.opponents ?? []).map(
        (opponent) => opponent as unknown as Id<"tournamentRegistrations">,
      ),
    ),
    hasHadBye: options.hasHadBye ?? false,
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
    ranked("A", { createdAt: 1 }),
    ranked("B", { createdAt: 2 }),
    ranked("C", { createdAt: 3, opponents: ["D"] }),
    ranked("D", { createdAt: 4, opponents: ["C"] }),
  ];

  const pairings = buildSwissPairings(players, POWER_PAIR_FINAL);

  expect(pairings).toHaveLength(2);
  expect(pairings.every((pairing) => !pairing.isBye)).toBe(true);
  expect(orderedKeys(pairings)).not.toContain("C|D");
});

test("forces a float-down rather than repeating a pairing", () => {
  // A has played everyone in its bracket except F, so A must float to F.
  const players = [
    ranked("A", { points: 6, createdAt: 1, opponents: ["B", "C", "D", "E"] }),
    ranked("B", { points: 6, createdAt: 2, opponents: ["A"] }),
    ranked("C", { points: 6, createdAt: 3, opponents: ["A"] }),
    ranked("D", { points: 6, createdAt: 4, opponents: ["A"] }),
    ranked("E", { points: 6, createdAt: 5, opponents: ["A"] }),
    ranked("F", { points: 3, createdAt: 6 }),
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
    ranked("A", { createdAt: 1, opponents: ["B", "C", "D"] }),
    ranked("B", { createdAt: 2, opponents: ["A", "C", "D"] }),
    ranked("C", { createdAt: 3, opponents: ["A", "B", "D"] }),
    ranked("D", { createdAt: 4, opponents: ["A", "B", "C"] }),
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
    ranked("A", { createdAt: 1 }),
    ranked("B", { createdAt: 2 }),
    ranked("C", { createdAt: 3 }),
    ranked("D", { createdAt: 4 }),
    ranked("E", { createdAt: 5, hasHadBye: true }),
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
      ranked(`P${index}`, { createdAt: index + 1 }),
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
    ranked("A", { points: 6, createdAt: 1, gameWinPct: 0.9 }),
    ranked("B", { points: 6, createdAt: 2, gameWinPct: 0.8 }),
    ranked("C", { points: 6, createdAt: 3, gameWinPct: 0.7 }),
    ranked("D", { points: 6, createdAt: 4, gameWinPct: 0.6 }),
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
