import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { matchPointsForResult } from "../model/standings";
import {
  MAX_TOURNAMENT_PLAYERS,
  adjustActiveRegistrationCount,
  matchPlayers,
  registrationDisplayName,
  registrationForUser,
  requireMatch,
  requireRegisteredPlayer,
  requireRound,
  requireTournament,
  swissPhaseOrNull,
} from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";

// A registration plays at most one match per round, so a player's
// tournamentMatchPlayers rows are bounded by the round cap (16).
const MAX_ROUNDS = 16;

type OpponentSummary = {
  registrationId: Id<"tournamentRegistrations">;
  name: string | null;
  avatarUrl: string | null;
};

export const getMyCurrentMatch = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament, registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    const base = {
      tournament: { name: tournament.name, status: tournament.status },
      myRegistrationStatus: registration.status,
      myRegistrationId: registration._id,
    };

    const phase = await swissPhaseOrNull(ctx, args.tournamentId);
    if (
      tournament.status === "private" ||
      tournament.status === "public" ||
      !phase?.phaseCurrentRound
    ) {
      return { kind: "not_started" as const, ...base };
    }

    const round = await requireRound(ctx, phase.phaseCurrentRound);
    const roundSummary = {
      roundNumber: round.roundNumber,
      roundName: round.roundName,
      roundStatus: round.roundStatus,
      isFinalRound:
        phase.phaseTotalRounds !== null &&
        round.roundNumber >= phase.phaseTotalRounds,
    };
    if (round.roundStatus === "completed") {
      return { kind: "between_rounds" as const, ...base, round: roundSummary };
    }

    const found = await playerMatchInRound(ctx, registration._id, round._id);
    if (!found) {
      return { kind: "no_match" as const, ...base, round: roundSummary };
    }

    const { match, myRow } = found;
    const players = await matchPlayers(ctx, match._id);
    const opponentRow = players.find((player) => player._id !== myRow._id);
    let opponent: OpponentSummary | null = null;
    if (opponentRow) {
      const opponentRegistration = await ctx.db.get(opponentRow.playerId);
      const opponentUser = opponentRegistration
        ? await ctx.db.get(opponentRegistration.userId)
        : null;
      opponent = {
        registrationId: opponentRow.playerId,
        name: opponentUser?.name ?? null,
        avatarUrl: opponentUser?.avatarUrl ?? null,
      };
    }

    return {
      kind: "match" as const,
      ...base,
      round: roundSummary,
      match: {
        _id: match._id,
        tableNumber: match.tableNumber ?? null,
        matchStatus: match.matchStatus,
        reportedByRegistrationId: match.reportedByRegistrationId ?? null,
      },
      me: {
        registrationId: registration._id,
        gameWins: myRow.gameWins ?? null,
        gameLosses: myRow.gameLosses ?? null,
        isBye: myRow.isBye,
      },
      opponent,
    };
  },
});

export const getMyMatchHistory = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registration._id))
      .take(MAX_ROUNDS);

    const history = [];
    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== args.tournamentId) {
        continue;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (!round) {
        continue;
      }

      let opponentName: string | null = null;
      if (playerRow.opponentPlayerId) {
        const opponentRegistration = await ctx.db.get(
          playerRow.opponentPlayerId,
        );
        const opponentUser = opponentRegistration
          ? await ctx.db.get(opponentRegistration.userId)
          : null;
        opponentName = opponentUser?.name ?? null;
      }

      history.push({
        roundNumber: round.roundNumber,
        roundName: round.roundName,
        opponentName,
        isBye: playerRow.isBye,
        myGameWins: playerRow.gameWins ?? null,
        myGameLosses: playerRow.gameLosses ?? null,
        result: matchResultForRow(match, playerRow),
      });
    }

    history.sort((left, right) => left.roundNumber - right.roundNumber);
    return history;
  },
});

export const getLatestStandings = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    const phase = await swissPhaseOrNull(ctx, args.tournamentId);
    if (!phase) {
      return null;
    }

    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .order("desc")
      .take(MAX_ROUNDS);
    const latestCompleted = rounds.find(
      (round) => round.roundStatus === "completed",
    );
    if (!latestCompleted) {
      return null;
    }

    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", latestCompleted._id),
      )
      .take(MAX_TOURNAMENT_PLAYERS);
    const rows = await Promise.all(
      standings.map(async (standing) => {
        const name =
          standing.playerName ??
          (await registrationDisplayName(ctx, standing.playerId));
        return {
          rank: standing.rank,
          name: name ?? null,
          matchPoints: standing.matchPoints,
          matchWins: standing.matchWins,
          matchLosses: standing.matchLosses,
          matchDraws: standing.matchDraws,
          opponentMatchWinPct: standing.opponentMatchWinPct,
          gameWinPct: standing.gameWinPct,
          opponentGameWinPct: standing.opponentGameWinPct,
          isMe: standing.playerId === registration._id,
        };
      }),
    );

    return { roundNumber: latestCompleted.roundNumber, rows };
  },
});

export const reportMyMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    myGameWins: v.number(),
    opponentGameWins: v.number(),
  },
  handler: async (ctx, args) => {
    const { match, myRow, opponentRow } = await requireMatchParticipant(
      ctx,
      args.matchId,
    );
    if (match.matchStatus !== "upcoming") {
      throw new Error("Match already has a result");
    }
    const myGameWins = validGameWins(args.myGameWins);
    const opponentGameWins = validGameWins(args.opponentGameWins);

    const [myPoints, opponentPoints] = matchPointsForResult({
      playerOneGameWins: myGameWins,
      playerTwoGameWins: opponentGameWins,
    });
    const now = Date.now();
    await ctx.db.patch(myRow._id, {
      matchPointsEarned: myPoints,
      gameWins: myGameWins,
      gameLosses: opponentGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(opponentRow._id, {
      matchPointsEarned: opponentPoints,
      gameWins: opponentGameWins,
      gameLosses: myGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(match._id, {
      matchStatus: "completed",
      reportedByRegistrationId: myRow.playerId,
      updatedAt: now,
    });
    return match._id;
  },
});

export const confirmMatchResult = mutation({
  args: { matchId: v.id("tournamentMatches") },
  handler: async (ctx, args) => {
    const { match, myRow } = await requireMatchParticipant(ctx, args.matchId);
    if (
      match.matchStatus !== "completed" ||
      !match.reportedByRegistrationId
    ) {
      throw new Error("Match has no player-reported result to confirm");
    }
    if (match.reportedByRegistrationId === myRow.playerId) {
      throw new Error("The reporting player cannot confirm their own result");
    }

    await ctx.db.patch(match._id, {
      matchStatus: "confirmed",
      updatedAt: Date.now(),
    });
    return match._id;
  },
});

export const dropSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (tournament.status !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration || registration.status !== "active") {
      throw new Error("Active registration not found");
    }

    const now = Date.now();
    await ctx.db.patch(registration._id, {
      status: "dropped",
      updatedAt: now,
    });
    await adjustActiveRegistrationCount(ctx, tournament, -1, now);
    return registration._id;
  },
});

async function playerMatchInRound(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
  roundId: Id<"tournamentRounds">,
) {
  const playerRows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
    .take(MAX_ROUNDS);
  for (const myRow of playerRows) {
    const match = await ctx.db.get(myRow.tournamentMatchId);
    if (match && match.tournamentRoundId === roundId) {
      return { match, myRow };
    }
  }
  return null;
}

// Being one of the match's two players is the authorization: a dropped player
// may still owe the result for the round they dropped in.
async function requireMatchParticipant(ctx: MutationCtx, matchId: Id<"tournamentMatches">) {
  const user = await ensureCurrentUser(ctx);
  const match = await requireMatch(ctx, matchId);
  const tournament = await requireTournament(ctx, match.tournamentId);
  if (tournament.status !== "in_progress") {
    throw new Error("Tournament is not in progress");
  }
  const registration = await registrationForUser(
    ctx,
    match.tournamentId,
    user._id,
  );
  if (!registration) {
    throw new Error("Not registered for this tournament");
  }

  const players = await matchPlayers(ctx, matchId);
  if (players.length !== 2) {
    throw new Error("Only two-player matches can be reported by players");
  }
  const myRow = players.find((player) => player.playerId === registration._id);
  if (!myRow) {
    throw new Error("You are not part of this match");
  }
  const opponentRow = players.find((player) => player._id !== myRow._id);
  if (!opponentRow) {
    throw new Error("Opponent not found for this match");
  }

  return { match, tournament, registration, players, myRow, opponentRow };
}

function matchResultForRow(
  match: Doc<"tournamentMatches">,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  if (
    match.matchStatus !== "completed" &&
    match.matchStatus !== "confirmed"
  ) {
    return "pending" as const;
  }
  const gameWins = playerRow.gameWins ?? 0;
  const gameLosses = playerRow.gameLosses ?? 0;
  if (playerRow.isBye || gameWins > gameLosses) {
    return "win" as const;
  }
  return gameWins < gameLosses ? ("loss" as const) : ("draw" as const);
}

function validGameWins(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error("Game wins must be a whole number between 0 and 2");
  }
  return value;
}
