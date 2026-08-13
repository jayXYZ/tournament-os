import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { previousTournamentRound } from "./phases";
import {
  MAX_TOURNAMENT_PLAYERS,
  nonActiveParticipationStatuses,
  participantRegistrations,
} from "./registrations";
import { roundMatchesWithPlayers } from "./tournaments";

export type RoundMatchWithPlayers = Awaited<
  ReturnType<typeof roundMatchesWithPlayers>
>[number];

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
  // Seed-derived per-player random (see model/random.ts) breaking residual
  // perfect ties; the registration id is the absolute final order so two
  // colliding hashes still compare deterministically.
  tiebreakRandom: number;
  tiebreakId: string;
};

export type PlayerStats = {
  registration: Doc<"tournamentRegistrations">;
  matchPoints: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  gameWins: number;
  gameLosses: number;
  gameDraws: number;
  opponentIds: Id<"tournamentRegistrations">[];
  // Bye totals kept separately so the percentages this player feeds into
  // opponents' tiebreakers can exclude their byes (MTR Appendix C), while
  // their own game-win percentage keeps them.
  byeCount: number;
  byeGameWins: number;
  tiebreakRandom: number;
};

type PlayoffStandingStatus = "not_started" | "active" | "eliminated" | "cut";

type RankedPlayerStats = {
  playerStats: PlayerStats;
  playoffStatus: PlayoffStandingStatus;
  eliminatedInRoundNumber?: number;
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
    right.tiebreakRandom - left.tiebreakRandom ||
    left.tiebreakId.localeCompare(right.tiebreakId)
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
    standing.gameDraws !== undefined &&
    standing.opponentIds !== undefined &&
    standing.byeCount !== undefined &&
    standing.byeGameWins !== undefined
  );
}

// Module-private on purpose: dropping a round's standings without either
// rewriting them or repairing the rows this promotes leaves a stale
// participation status on the standings every player reads. Callers outside
// this module go through replaceStandingsForRound or
// deleteStandingsForReopenedRound.
async function deleteStandingsForRound(
  ctx: MutationCtx,
  roundId: Id<"tournamentRounds">,
) {
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  for (const standing of standings) {
    await ctx.db.delete(standing._id);
  }
}

// Deletes the standings of a round a rewind is reopening, then repairs the
// participation status denormalized onto the rows this promotes to "latest
// completed round" — the rows every player's standings query will now read.
// Called only by restoreEliminationsForRewind (model/participation.ts), which
// restores the rewound rounds' eliminations first so the repair below reads
// registrations the rewind has already corrected.
//
// Only the latest completed round's rows are kept current (see
// model/participation.ts), so the promoted rows still hold whatever
// status they carried when their round stopped being the latest: a player
// dropped while the deleted round was on screen would silently read as active
// again. Reading them back from the live registrations closes that window.
// replaceStandingsForRound needs no equivalent — it rewrites the same round's
// rows from the live registrations in the same transaction.
export async function deleteStandingsForReopenedRound(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  round: Doc<"tournamentRounds">,
) {
  await deleteStandingsForRound(ctx, round._id);
  const promoted = await previousTournamentRound(ctx, round);
  if (!promoted) {
    return;
  }
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", promoted._id),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  if (standings.length === 0) {
    return;
  }
  const nonActive = await nonActiveParticipationStatuses(ctx, tournamentId);
  const now = Date.now();
  for (const standing of standings) {
    const participationStatus = nonActive.get(standing.playerId) ?? "active";
    if (standing.participationStatus !== participationStatus) {
      await ctx.db.patch(standing._id, { participationStatus, updatedAt: now });
    }
  }
}

// Rewrites the round's standings from cumulative stats through it, making it
// the tournament's latest completed round — the round whose rows the
// participation module keeps in step with every later status change (see
// model/participation.ts).
export async function replaceStandingsForRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  phase: Doc<"tournamentPhases">,
  round: Doc<"tournamentRounds">,
  prefetchedMatches?: RoundMatchWithPlayers[],
): Promise<void> {
  await deleteStandingsForRound(ctx, round._id);

  const matchesWithPlayers =
    prefetchedMatches ?? (await roundMatchesWithPlayers(ctx, round._id));
  const stats = await cumulativeStatsThroughRound(
    ctx,
    tournament,
    round,
    matchesWithPlayers,
  );
  const ranked = await rankedStatsForRound(
    ctx,
    stats,
    phase,
    round,
    matchesWithPlayers,
  );
  const now = Date.now();

  for (let index = 0; index < ranked.length; index += 1) {
    const { playerStats, playoffStatus, eliminatedInRoundNumber } =
      ranked[index];
    const comparable = comparableFromStats(playerStats, stats);
    await ctx.db.insert("roundStandings", {
      tournamentId: tournament._id,
      tournamentPhaseId: phase._id,
      tournamentRoundId: round._id,
      playerId: playerStats.registration._id,
      playerName: playerStats.registration.playerName,
      rank: index + 1,
      matchPoints: playerStats.matchPoints,
      matchWins: playerStats.matchWins,
      matchLosses: playerStats.matchLosses,
      matchDraws: playerStats.matchDraws,
      gameWins: playerStats.gameWins,
      gameLosses: playerStats.gameLosses,
      gameDraws: playerStats.gameDraws,
      opponentIds: playerStats.opponentIds,
      byeCount: playerStats.byeCount,
      byeGameWins: playerStats.byeGameWins,
      opponentMatchWinPct: comparable.opponentMatchWinPct,
      gameWinPct: comparable.gameWinPct,
      opponentGameWinPct: comparable.opponentGameWinPct,
      playoffStatus,
      eliminatedInRoundNumber,
      // Free here — the registration document is already in hand — and it
      // saves the player standings query a per-tournament scan of every
      // non-active registration. The participation module keeps it current
      // for status changes that land after this round's standings are
      // written.
      participationStatus: playerStats.registration.participationStatus,
      sortKey: index + 1,
      updatedAt: now,
    });
  }
}

async function rankedStatsForRound(
  ctx: QueryCtx,
  stats: Map<Id<"tournamentRegistrations">, PlayerStats>,
  phase: Doc<"tournamentPhases">,
  round: Doc<"tournamentRounds">,
  matchesWithPlayers: RoundMatchWithPlayers[],
): Promise<RankedPlayerStats[]> {
  // Every participant is ranked, not just active players: MTR final
  // standings keep dropped players listed with their frozen record, and a
  // player cut at a phase boundary keeps their placement in later rounds
  // (65th after a top-64 cut stays visible in 65th). Points and tiebreakers
  // alone decide order, so non-active players sink naturally as the field
  // keeps scoring. The stats map contains only confirmed entries; cancelled,
  // rejected, pending, and waitlisted registrations never reach standings.
  // Cutoffs and top-8 seeding live-join participation status and skip players
  // who are no longer active.
  if (phase.phaseType !== "single_elimination") {
    return [...stats.values()]
      .sort((left, right) => comparePlayerStats(left, right, stats))
      .map((playerStats) => ({
        playerStats,
        playoffStatus: "not_started",
      }));
  }

  const previousRound = await previousTournamentRound(ctx, round);
  const previousStandings = previousRound
    ? await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", previousRound._id),
        )
        .take(MAX_TOURNAMENT_PLAYERS)
    : [];
  const previousByPlayer = new Map(
    previousStandings.map((standing) => [standing.playerId, standing]),
  );

  const currentParticipants = new Set<Id<"tournamentRegistrations">>();
  const currentAdvancers = new Set<Id<"tournamentRegistrations">>();
  for (const { players } of matchesWithPlayers) {
    // A walkover: the departed seat-holder's scheduled opponent received the
    // match as a Bye (see CONTEXT.md "Walkover").
    if (players.length === 1 && players[0].isBye) {
      currentParticipants.add(players[0].playerId);
      currentAdvancers.add(players[0].playerId);
      continue;
    }
    if (players.length !== 2) {
      throw new Error("Single-elimination matches require exactly two players");
    }
    const [first, second] = players;
    currentParticipants.add(first.playerId);
    currentParticipants.add(second.playerId);
    const firstWins = first.gameWins ?? 0;
    const secondWins = second.gameWins ?? 0;
    if (firstWins === secondWins) {
      throw new Error("Single-elimination matches must have a winner");
    }
    // The game winner advances whether or not they are still in the
    // tournament: a withdrawal never revives the defeated opponent — the
    // seat advances and the next pairing walks it over (ADR 0001).
    currentAdvancers.add(
      firstWins > secondWins ? first.playerId : second.playerId,
    );
  }

  const ranked = [...stats.values()].map((playerStats): RankedPlayerStats => {
    const playerId = playerStats.registration._id;
    if (currentAdvancers.has(playerId)) {
      return { playerStats, playoffStatus: "active" };
    }
    if (currentParticipants.has(playerId)) {
      return {
        playerStats,
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: round.roundNumber,
      };
    }

    const previous = previousByPlayer.get(playerId);
    if (previous?.playoffStatus === "active") {
      // A seat-holder absent from the round was walked over at pairing (or
      // their seat pair emptied entirely): they keep the placement of the
      // seat they reached — this round.
      return {
        playerStats,
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: round.roundNumber,
      };
    }
    if (previous?.playoffStatus === "eliminated") {
      return {
        playerStats,
        playoffStatus: "eliminated",
        eliminatedInRoundNumber: previous.eliminatedInRoundNumber,
      };
    }
    return { playerStats, playoffStatus: "cut" };
  });

  return ranked.sort((left, right) => {
    const advancementDifference =
      playoffAdvancement(right, round.roundNumber) -
      playoffAdvancement(left, round.roundNumber);
    return (
      advancementDifference ||
      comparePlayerStats(left.playerStats, right.playerStats, stats)
    );
  });
}

function playoffAdvancement(
  standing: RankedPlayerStats,
  currentRoundNumber: number,
) {
  if (standing.playoffStatus === "active") {
    return currentRoundNumber + 1;
  }
  if (standing.playoffStatus === "eliminated") {
    return standing.eliminatedInRoundNumber ?? 0;
  }
  return -1;
}

function comparePlayerStats(
  left: PlayerStats,
  right: PlayerStats,
  stats: Map<Id<"tournamentRegistrations">, PlayerStats>,
) {
  return compareStandingRows(
    comparableFromStats(left, stats),
    comparableFromStats(right, stats),
  );
}

// Folds the previous round's cumulative standings forward with only the
// current round's results, so completing a round reads O(players + matches)
// documents instead of every match in the tournament's history.
async function cumulativeStatsThroughRound(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds">,
  matchesWithPlayers: RoundMatchWithPlayers[],
) {
  // Dropped players stay in the map so their records keep feeding their
  // former opponents' OMW%/OGW% (MTR Appendix C: withdrawal does not erase
  // a record); they also stay ranked, with their record frozen at the point
  // they stopped playing.
  const registrations = await participantRegistrations(ctx, tournament._id);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>(
    registrations.map((registration) => [
      registration._id,
      emptyStats(registration),
    ]),
  );

  // Round numbers are global across phases, so round 1 is the tournament's
  // very first round and every later round folds from the one before it.
  if (round.roundNumber > 1) {
    const previousRound = await previousTournamentRound(ctx, round);
    const previousStandings = previousRound
      ? await ctx.db
          .query("roundStandings")
          .withIndex("by_tournamentRoundId_and_rank", (q) =>
            q.eq("tournamentRoundId", previousRound._id),
          )
          .take(MAX_TOURNAMENT_PLAYERS)
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
        playerStats.gameDraws = standing.gameDraws ?? 0;
        playerStats.opponentIds = [...(standing.opponentIds ?? [])];
        playerStats.byeCount = standing.byeCount ?? 0;
        playerStats.byeGameWins = standing.byeGameWins ?? 0;
      } else {
        // Legacy standings row or a player without one (e.g. reinstated
        // after a drop): rebuild this player's totals from match history.
        await accumulatePlayerHistory(
          ctx,
          tournament._id,
          playerStats,
          round.roundNumber - 1,
        );
      }
    }
  }

  for (const { match, players } of matchesWithPlayers) {
    if (match.matchStatus !== "completed") {
      continue;
    }
    for (const playerRow of players) {
      const playerStats = stats.get(playerRow.playerId);
      if (playerStats) {
        applyMatchPlayerRow(playerStats, playerRow);
      }
    }
  }

  return stats;
}

// Full-history recompute for a single player. Round numbers are global across
// phases, so a plain number bounds history anywhere in the tournament. Used as
// the fallback when cumulative totals are unavailable, and by tests as an
// oracle for the fold-forward path.
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
    .take(256);

  for (const playerRow of playerRows) {
    const match = await ctx.db.get(playerRow.tournamentMatchId);
    if (!match || match.tournamentId !== tournamentId) {
      continue;
    }
    if (match.matchStatus !== "completed") {
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
  throughRoundNumber: number,
) {
  const registrations = await participantRegistrations(ctx, tournamentId);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>(
    registrations.map((registration) => [
      registration._id,
      emptyStats(registration),
    ]),
  );

  for (const registration of registrations) {
    const playerStats = stats.get(registration._id);
    if (playerStats) {
      await accumulatePlayerHistory(
        ctx,
        tournamentId,
        playerStats,
        throughRoundNumber,
      );
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
    gameDraws: 0,
    opponentIds: [],
    byeCount: 0,
    byeGameWins: 0,
    tiebreakRandom: registration.tiebreakRandom,
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
  playerStats.gameDraws += playerRow.gameDraws ?? 0;
  if (playerRow.opponentPlayerId) {
    playerStats.opponentIds.push(playerRow.opponentPlayerId);
  }
  if (playerRow.isBye) {
    playerStats.byeCount += 1;
    playerStats.byeGameWins += playerRow.gameWins ?? 0;
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
      Math.max(0.33, feedMatchWinPct(allStats.get(opponentId))),
    ),
  );
  const opponentGameWinPct = averageOrFloor(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, feedGameWinPct(allStats.get(opponentId))),
    ),
  );

  return {
    matchPoints: playerStats.matchPoints,
    opponentMatchWinPct,
    // MTR Appendix C floors game-win percentage at 0.33 in its definition,
    // so the floor applies to a player's own tiebreaker, not just opponents'.
    gameWinPct: Math.max(0.33, ownGameWinPct(playerStats)),
    opponentGameWinPct,
    tiebreakRandom: playerStats.tiebreakRandom,
    tiebreakId: playerStats.registration._id,
  };
}

// Percentages are match/game points over points possible (MTR Appendix C),
// so drawn matches and drawn games count toward both sides of the division.
// Each comes in two variants: the player's own tiebreaker keeps their byes
// (a bye is an awarded win with awarded game points), while the value fed
// into an opponent's OMW%/OGW% excludes them — an opponent-less round says
// nothing about the strength anyone actually faced. Own match-win percentage
// has no own variant because it never ranks the player directly.

function feedMatchWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const matches =
    stats.matchWins + stats.matchLosses + stats.matchDraws - stats.byeCount;
  if (matches <= 0) {
    return 0;
  }
  // Every bye awarded exactly a match win's points, so subtracting them
  // leaves the points earned in played rounds.
  const matchPoints = stats.matchPoints - MATCH_WIN_POINTS * stats.byeCount;
  return matchPoints / (3 * matches);
}

function ownGameWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const games = stats.gameWins + stats.gameLosses + stats.gameDraws;
  if (games === 0) {
    return 0;
  }
  return (3 * stats.gameWins + stats.gameDraws) / (3 * games);
}

function feedGameWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const games =
    stats.gameWins + stats.gameLosses + stats.gameDraws - stats.byeGameWins;
  if (games <= 0) {
    return 0;
  }
  const gamePoints = 3 * (stats.gameWins - stats.byeGameWins) + stats.gameDraws;
  return gamePoints / (3 * games);
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
