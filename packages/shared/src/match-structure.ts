// A phase's Match Structure (see CONTEXT.md): best-of-1, -3, or -5, where
// "best of X" is shorthand for first to ⌈X/2⌉ game wins. A match that ends
// before either player gets there goes to whichever player has more game
// wins, and equal game wins is a match draw (single elimination forbids
// match draws — a phase-type rule enforced by the backend, not here).
// These helpers are the single definition of what a structure permits,
// shared by backend validation and client entry controls.

export const bestOfOptions = [1, 3, 5] as const;

export type BestOf = (typeof bestOfOptions)[number];

export const DEFAULT_BEST_OF: BestOf = 3;

export function isBestOf(value: number): value is BestOf {
  return (bestOfOptions as readonly number[]).includes(value);
}

// The game wins that take the match: "best of 3" means first to 2.
export function requiredGameWins(bestOf: BestOf): number {
  return (bestOf + 1) / 2;
}

// Drawn games never count toward X, so they get a flat sanity ceiling
// instead of a structure-derived one: a timed round cannot realistically
// produce more (see CONTEXT.md "Match Structure").
export const MAX_GAME_DRAWS = 3;

// Why a scoreline cannot be a real result under the structure, or null when
// it is valid. Non-drawn games never exceed X, nobody wins more games than
// the match requires, and drawn games are capped at MAX_GAME_DRAWS.
export function gameWinsEntryError(
  bestOf: BestOf,
  playerOneGameWins: number,
  playerTwoGameWins: number,
  gameDraws = 0,
): string | null {
  if (!Number.isInteger(gameDraws) || gameDraws < 0) {
    return "Drawn games must be a whole number of 0 or more";
  }
  if (gameDraws > MAX_GAME_DRAWS) {
    return `A match can record at most ${MAX_GAME_DRAWS} drawn games`;
  }
  const required = requiredGameWins(bestOf);
  for (const wins of [playerOneGameWins, playerTwoGameWins]) {
    if (!Number.isInteger(wins) || wins < 0) {
      return "Game wins must be a whole number of 0 or more";
    }
    if (wins > required) {
      return `A best-of-${bestOf} match is won at ${required} game ${
        required === 1 ? "win" : "wins"
      }`;
    }
  }
  if (playerOneGameWins + playerTwoGameWins > bestOf) {
    return `Game wins can total at most ${bestOf} in a best-of-${bestOf} match`;
  }
  return null;
}
