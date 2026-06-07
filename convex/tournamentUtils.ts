export const SWISS_FORMAT = "swiss";
export const MATCH_WIN_POINTS = 3;
export const MATCH_DRAW_POINTS = 1;
export const BYE_MATCH_POINTS = 3;

export type MatchResultInput = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws?: number;
};

export type SimulatedMatchResult = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws: number;
};

export type StandingComparable = {
  matchPoints: number;
  opponentMatchWinPct: number;
  gameWinPct: number;
  opponentGameWinPct: number;
  createdAt: number;
};

export function defaultSwissRoundCount(playerCount: number) {
  if (playerCount <= 1) {
    return 1;
  }

  return Math.ceil(Math.log2(playerCount));
}

export function createSeededRandom(seed: number) {
  let state = Math.trunc(seed) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function compareStandingRows(
  left: StandingComparable,
  right: StandingComparable,
) {
  return (
    right.matchPoints - left.matchPoints ||
    right.opponentMatchWinPct - left.opponentMatchWinPct ||
    right.gameWinPct - left.gameWinPct ||
    right.opponentGameWinPct - left.opponentGameWinPct ||
    left.createdAt - right.createdAt
  );
}

export function matchPointsForResult(result: MatchResultInput) {
  if (result.playerOneGameWins > result.playerTwoGameWins) {
    return [MATCH_WIN_POINTS, 0] as const;
  }

  if (result.playerTwoGameWins > result.playerOneGameWins) {
    return [0, MATCH_WIN_POINTS] as const;
  }

  return [MATCH_DRAW_POINTS, MATCH_DRAW_POINTS] as const;
}

export function simulatedMatchResult(random: () => number): SimulatedMatchResult {
  const roll = random();

  if (roll < 0.08) {
    return { playerOneGameWins: 1, playerTwoGameWins: 1, draws: 1 };
  }

  if (roll < 0.54) {
    return random() < 0.7
      ? { playerOneGameWins: 2, playerTwoGameWins: 0, draws: 0 }
      : { playerOneGameWins: 2, playerTwoGameWins: 1, draws: 0 };
  }

  return random() < 0.7
    ? { playerOneGameWins: 0, playerTwoGameWins: 2, draws: 0 }
    : { playerOneGameWins: 1, playerTwoGameWins: 2, draws: 0 };
}
