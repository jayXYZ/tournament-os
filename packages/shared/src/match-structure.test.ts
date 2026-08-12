import { describe, expect, it } from "vitest";

import {
  DEFAULT_BEST_OF,
  bestOfOptions,
  gameWinsEntryError,
  isBestOf,
  requiredGameWins,
} from "./match-structure";

describe("isBestOf", () => {
  it("accepts exactly the supported structures", () => {
    expect(bestOfOptions).toEqual([1, 3, 5]);
    expect(isBestOf(DEFAULT_BEST_OF)).toBe(true);
    for (const value of [0, 2, 4, 6, 7, 1.5, -3, Number.NaN]) {
      expect(isBestOf(value)).toBe(false);
    }
  });
});

describe("requiredGameWins", () => {
  it("is first-to-⌈X/2⌉", () => {
    expect(requiredGameWins(1)).toBe(1);
    expect(requiredGameWins(3)).toBe(2);
    expect(requiredGameWins(5)).toBe(3);
  });
});

describe("gameWinsEntryError", () => {
  it("accepts complete and time-shortened results", () => {
    expect(gameWinsEntryError(3, 2, 0)).toBeNull();
    expect(gameWinsEntryError(3, 2, 1)).toBeNull();
    expect(gameWinsEntryError(3, 1, 0)).toBeNull();
    expect(gameWinsEntryError(3, 1, 1)).toBeNull();
    expect(gameWinsEntryError(3, 0, 0)).toBeNull();
    expect(gameWinsEntryError(1, 1, 0)).toBeNull();
    expect(gameWinsEntryError(1, 0, 0)).toBeNull();
    expect(gameWinsEntryError(5, 3, 2)).toBeNull();
    expect(gameWinsEntryError(5, 2, 2)).toBeNull();
  });

  it("rejects non-integer or negative wins", () => {
    expect(gameWinsEntryError(3, 1.5, 0)).toMatch(/whole number/);
    expect(gameWinsEntryError(3, -1, 0)).toMatch(/whole number/);
    expect(gameWinsEntryError(3, 0, Number.NaN)).toMatch(/whole number/);
  });

  it("rejects wins beyond the required count", () => {
    expect(gameWinsEntryError(3, 3, 0)).toMatch(/won at 2 game wins/);
    expect(gameWinsEntryError(1, 2, 0)).toMatch(/won at 1 game win/);
    expect(gameWinsEntryError(5, 4, 0)).toMatch(/won at 3 game wins/);
  });

  it("rejects totals beyond the match length", () => {
    expect(gameWinsEntryError(3, 2, 2)).toMatch(/total at most 3/);
    expect(gameWinsEntryError(1, 1, 1)).toMatch(/total at most 1/);
    expect(gameWinsEntryError(5, 3, 3)).toMatch(/total at most 5/);
  });

  it("bounds drawn games at the flat cap without counting them toward X", () => {
    expect(gameWinsEntryError(3, 1, 1, 1)).toBeNull();
    expect(gameWinsEntryError(1, 0, 0, 2)).toBeNull();
    expect(gameWinsEntryError(3, 2, 1, 3)).toBeNull();
    expect(gameWinsEntryError(3, 0, 0, 4)).toMatch(/at most 3 drawn games/);
    expect(gameWinsEntryError(3, 0, 0, -1)).toMatch(/whole number/);
    expect(gameWinsEntryError(3, 0, 0, 1.5)).toMatch(/whole number/);
  });
});
