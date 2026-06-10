import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { activeRegistrations } from "./tournaments";

export const MATCH_WIN_POINTS = 3;
export const MATCH_DRAW_POINTS = 1;
export const BYE_MATCH_POINTS = 3;

export type MatchResultInput = {
  playerOneGameWins: number;
  playerTwoGameWins: number;
  draws?: number;
};

export type StandingComparable = {
  matchPoints: number;
  opponentMatchWinPct: number;
  gameWinPct: number;
  opponentGameWinPct: number;
  createdAt: number;
};

export type PlayerStats = {
  registration: Doc<"tournamentRegistrations">;
  matchPoints: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  gameWins: number;
  gameLosses: number;
  opponentIds: Id<"tournamentRegistrations">[];
  createdAt: number;
};

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

export async function replaceStandingsForRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  phase: Doc<"tournamentPhases">,
  round: Doc<"tournamentRounds">,
) {
  const existing = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", round._id),
    )
    .take(512);
  for (const standing of existing) {
    await ctx.db.delete(standing._id);
  }

  const stats = await calculatePlayerStatsThroughRound(
    ctx,
    tournament._id,
    round.roundNumber,
  );
  const ranked = [...stats.values()].sort((left, right) =>
    compareStandingRows(
      comparableFromStats(left, stats),
      comparableFromStats(right, stats),
    ),
  );
  const now = Date.now();

  for (let index = 0; index < ranked.length; index += 1) {
    const playerStats = ranked[index];
    const comparable = comparableFromStats(playerStats, stats);
    await ctx.db.insert("roundStandings", {
      tournamentId: tournament._id,
      tournamentPhaseId: phase._id,
      tournamentRoundId: round._id,
      playerId: playerStats.registration._id,
      rank: index + 1,
      matchPoints: playerStats.matchPoints,
      matchWins: playerStats.matchWins,
      matchLosses: playerStats.matchLosses,
      matchDraws: playerStats.matchDraws,
      opponentMatchWinPct: comparable.opponentMatchWinPct,
      gameWinPct: comparable.gameWinPct,
      opponentGameWinPct: comparable.opponentGameWinPct,
      sortKey: index + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function calculatePlayerStatsThroughRound(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  roundNumber: number,
) {
  const registrations = await activeRegistrations(ctx, tournamentId);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>();
  for (const registration of registrations) {
    stats.set(registration._id, {
      registration,
      matchPoints: 0,
      matchWins: 0,
      matchLosses: 0,
      matchDraws: 0,
      gameWins: 0,
      gameLosses: 0,
      opponentIds: [],
      createdAt: registration.createdAt,
    });
  }

  for (const registration of registrations) {
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registration._id))
      .take(64);
    const playerStats = stats.get(registration._id);
    if (!playerStats) {
      continue;
    }

    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        continue;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (
        !round ||
        round.roundNumber > roundNumber ||
        (match.matchStatus !== "completed" && match.matchStatus !== "confirmed")
      ) {
        continue;
      }

      const points = playerRow.matchPointsEarned ?? 0;
      playerStats.matchPoints += points;
      playerStats.gameWins += playerRow.gameWins ?? 0;
      playerStats.gameLosses += playerRow.gameLosses ?? 0;
      if (playerRow.opponentPlayerId) {
        playerStats.opponentIds.push(playerRow.opponentPlayerId);
      }
      if (points === MATCH_WIN_POINTS || playerRow.isBye) {
        playerStats.matchWins += 1;
      } else if (points === MATCH_DRAW_POINTS) {
        playerStats.matchDraws += 1;
      } else {
        playerStats.matchLosses += 1;
      }
    }
  }

  return stats;
}

export function comparableFromStats(
  playerStats: PlayerStats,
  allStats: Map<Id<"tournamentRegistrations">, PlayerStats>,
): StandingComparable {
  const opponentMatchWinPct = average(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, matchWinPct(allStats.get(opponentId))),
    ),
  );
  const opponentGameWinPct = average(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, gameWinPct(allStats.get(opponentId))),
    ),
  );

  return {
    matchPoints: playerStats.matchPoints,
    opponentMatchWinPct,
    gameWinPct: gameWinPct(playerStats),
    opponentGameWinPct,
    createdAt: playerStats.createdAt,
  };
}

function matchWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const matches = stats.matchWins + stats.matchLosses + stats.matchDraws;
  if (matches === 0) {
    return 0;
  }
  return (stats.matchWins + stats.matchDraws / 3) / matches;
}

function gameWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const games = stats.gameWins + stats.gameLosses;
  if (games === 0) {
    return 0;
  }
  return stats.gameWins / games;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
