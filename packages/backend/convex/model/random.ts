// Deterministic randomness shared by pairing's within-bracket shuffle and the
// test result simulator. Keeping it dependency-free (no Convex imports) lets
// both model/pairing.ts and model/testing.ts use it without import cycles.

// Linear congruential generator. Returns a function producing values in [0, 1).
export function createSeededRandom(seed: number) {
  let state = Math.trunc(seed) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Folds the tournament seed, round number, and bracket (match-point) value into
// one 32-bit seed so every round and every bracket shuffles differently while
// staying reproducible from the stored tournament seed.
export function pairingSeed(
  seed: number,
  roundNumber: number,
  points: number,
): number {
  return (
    ((Math.trunc(seed) ^
      Math.imul(roundNumber, 2654435761) ^
      Math.imul(points, 40503)) >>>
      0) ||
    1
  );
}

// In-place Fisher-Yates shuffle driven by a seeded PRNG.
export function seededShuffle<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [items[index], items[swapWith]] = [items[swapWith], items[index]];
  }
}
