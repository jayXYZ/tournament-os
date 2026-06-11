import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { allRegistrations, matchPlayers, roundMatches } from "./tournaments";

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
  hasHadBye: boolean;
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

export function hasCumulativeTotals(standing: Doc<"roundStandings">) {
  return (
    standing.gameWins !== undefined &&
    standing.gameLosses !== undefined &&
    standing.opponentIds !== undefined &&
    standing.hasHadBye !== undefined
  );
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

  const stats = await cumulativeStatsThroughRound(ctx, tournament._id, phase, round);
  const ranked = [...stats.values()]
    .filter((playerStats) => playerStats.registration.status === "active")
    .sort((left, right) =>
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
      gameWins: playerStats.gameWins,
      gameLosses: playerStats.gameLosses,
      opponentIds: playerStats.opponentIds,
      hasHadBye: playerStats.hasHadBye,
      opponentMatchWinPct: comparable.opponentMatchWinPct,
      gameWinPct: comparable.gameWinPct,
      opponentGameWinPct: comparable.opponentGameWinPct,
      sortKey: index + 1,
      updatedAt: now,
    });
  }
}

// Folds the previous round's cumulative standings forward with only the
// current round's results, so completing a round reads O(players + matches)
// documents instead of every match in the tournament's history.
async function cumulativeStatsThroughRound(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  phase: Doc<"tournamentPhases">,
  round: Doc<"tournamentRounds">,
) {
  // Dropped players stay in the map so their records keep feeding their
  // former opponents' OMW%/OGW% (MTR Appendix C: withdrawal does not erase
  // a record); they are filtered out before ranks are assigned.
  const registrations = await allRegistrations(ctx, tournamentId);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>(
    registrations.map((registration) => [
      registration._id,
      emptyStats(registration),
    ]),
  );

  if (round.roundNumber > 1) {
    const previousRound = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q
          .eq("tournamentPhaseId", phase._id)
          .eq("roundNumber", round.roundNumber - 1),
      )
      .unique();
    const previousStandings = previousRound
      ? await ctx.db
          .query("roundStandings")
          .withIndex("by_tournamentRoundId_and_rank", (q) =>
            q.eq("tournamentRoundId", previousRound._id),
          )
          .take(512)
      : [];
    const standingByPlayer = new Map(
      previousStandings.map((standing) => [standing.playerId, standing]),
    );

    for (const registration of registrations) {
      const playerStats = stats.get(registration._id);
      if (!playerStats) {
        continue;
      }
      const standing = standingByPlayer.get(registration._id);
      if (standing && hasCumulativeTotals(standing)) {
        playerStats.matchPoints = standing.matchPoints;
        playerStats.matchWins = standing.matchWins;
        playerStats.matchLosses = standing.matchLosses;
        playerStats.matchDraws = standing.matchDraws;
        playerStats.gameWins = standing.gameWins ?? 0;
        playerStats.gameLosses = standing.gameLosses ?? 0;
        playerStats.opponentIds = [...(standing.opponentIds ?? [])];
        playerStats.hasHadBye = standing.hasHadBye ?? false;
      } else {
        // Legacy standings row or a player without one (e.g. reinstated
        // after a drop): rebuild this player's totals from match history.
        await accumulatePlayerHistory(
          ctx,
          tournamentId,
          playerStats,
          round.roundNumber - 1,
        );
      }
    }
  }

  for (const match of await roundMatches(ctx, round._id)) {
    if (
      match.matchStatus !== "completed" &&
      match.matchStatus !== "confirmed"
    ) {
      continue;
    }
    for (const playerRow of await matchPlayers(ctx, match._id)) {
      const playerStats = stats.get(playerRow.playerId);
      if (playerStats) {
        applyMatchPlayerRow(playerStats, playerRow);
      }
    }
  }

  return stats;
}

// Full-history recompute for a single player. Used as the fallback when
// cumulative totals are unavailable, and by tests as an oracle for the
// fold-forward path.
export async function accumulatePlayerHistory(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  playerStats: PlayerStats,
  throughRoundNumber: number,
) {
  const playerRows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) =>
      q.eq("playerId", playerStats.registration._id),
    )
    .take(64);

  for (const playerRow of playerRows) {
    const match = await ctx.db.get(playerRow.tournamentMatchId);
    if (!match || match.tournamentId !== tournamentId) {
      continue;
    }
    if (
      match.matchStatus !== "completed" &&
      match.matchStatus !== "confirmed"
    ) {
      continue;
    }
    const round = await ctx.db.get(match.tournamentRoundId);
    if (!round || round.roundNumber > throughRoundNumber) {
      continue;
    }

    applyMatchPlayerRow(playerStats, playerRow);
  }
}

export async function recomputeStatsThroughRound(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  roundNumber: number,
) {
  const registrations = await allRegistrations(ctx, tournamentId);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>(
    registrations.map((registration) => [
      registration._id,
      emptyStats(registration),
    ]),
  );

  for (const registration of registrations) {
    const playerStats = stats.get(registration._id);
    if (playerStats) {
      await accumulatePlayerHistory(ctx, tournamentId, playerStats, roundNumber);
    }
  }

  return stats;
}

function emptyStats(registration: Doc<"tournamentRegistrations">): PlayerStats {
  return {
    registration,
    matchPoints: 0,
    matchWins: 0,
    matchLosses: 0,
    matchDraws: 0,
    gameWins: 0,
    gameLosses: 0,
    opponentIds: [],
    hasHadBye: false,
    createdAt: registration.createdAt,
  };
}

function applyMatchPlayerRow(
  playerStats: PlayerStats,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  const points = playerRow.matchPointsEarned ?? 0;
  playerStats.matchPoints += points;
  playerStats.gameWins += playerRow.gameWins ?? 0;
  playerStats.gameLosses += playerRow.gameLosses ?? 0;
  if (playerRow.opponentPlayerId) {
    playerStats.opponentIds.push(playerRow.opponentPlayerId);
  }
  if (playerRow.isBye) {
    playerStats.hasHadBye = true;
  }
  if (points === MATCH_WIN_POINTS || playerRow.isBye) {
    playerStats.matchWins += 1;
  } else if (points === MATCH_DRAW_POINTS) {
    playerStats.matchDraws += 1;
  } else {
    playerStats.matchLosses += 1;
  }
}

export function comparableFromStats(
  playerStats: PlayerStats,
  allStats: Map<Id<"tournamentRegistrations">, PlayerStats>,
): StandingComparable {
  const opponentMatchWinPct = averageOrFloor(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, matchWinPct(allStats.get(opponentId))),
    ),
  );
  const opponentGameWinPct = averageOrFloor(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, gameWinPct(allStats.get(opponentId))),
    ),
  );

  return {
    matchPoints: playerStats.matchPoints,
    opponentMatchWinPct,
    // MTR Appendix C floors game-win percentage at 0.33 in its definition,
    // so the floor applies to a player's own tiebreaker, not just opponents'.
    gameWinPct: Math.max(0.33, gameWinPct(playerStats)),
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

// A player with only byes has no opponents to average; MTR's per-opponent
// floor makes 0.33 the lowest achievable value, so it is also the default —
// returning 0 would rank a bye below every real win.
function averageOrFloor(values: number[]) {
  if (values.length === 0) {
    return 0.33;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
