import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { applyMatchResult } from "../model/matchResults";
import { latestCompletedRound, requirePhase } from "../model/phases";
import { dropPlayer } from "../model/roster";
import {
  MAX_TOURNAMENT_PLAYERS,
  playerVisibleParticipationStatus,
  registrationForUser,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import { matchLogForRegistration } from "../model/playerResults";
import { currentMatchForPlayer } from "../model/playerView";
import {
  isPairingsVisibleToPlayers,
  matchPlayers,
  requireMatch,
  requireRegisteredPlayer,
  requireRound,
  requireTournament,
} from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";

export const getMyCurrentMatch = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament, registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    return await currentMatchForPlayer(ctx, tournament, registration);
  },
});

export const getMyMatchHistory = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    return await matchLogForRegistration(
      ctx,
      args.tournamentId,
      registration._id,
    );
  },
});

export const getLatestStandings = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    const latestCompleted = await latestCompletedRound(ctx, args.tournamentId);
    if (!latestCompleted) {
      return null;
    }

    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", latestCompleted._id),
      )
      .take(MAX_TOURNAMENT_PLAYERS);
    // Every player in the event subscribes to this query, so it reads no
    // registration documents at all: participation status is denormalized onto
    // the standings row, and the participation module writes each change
    // through to the latest completed round's rows (see model/participation.ts).
    // A drop or reinstate between rounds therefore still shows immediately —
    // it patches the very rows this query reads — while a 500-player field no
    // longer costs one read and one subscription dependency per non-active
    // player on every execution.
    const rows = await mapAsyncInBatches(
      standings,
      DATABASE_IO_BATCH_SIZE,
      async (standing) => {
        const name = await resolveRegistrationDisplayName(
          ctx,
          standing.playerName,
          standing.playerId,
        );
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
          playoffStatus: standing.playoffStatus,
          eliminatedInRoundNumber: standing.eliminatedInRoundNumber ?? null,
          registrationStatus: playerVisibleParticipationStatus(
            standing.participationStatus ?? "active",
          ),
          isMe: standing.playerId === registration._id,
        };
      },
    );

    return { roundNumber: latestCompleted.roundNumber, rows };
  },
});

export const reportMyMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    myGameWins: v.number(),
    opponentGameWins: v.number(),
    gameDraws: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "reportResult");
    const { match, round, myRow, opponentRow, user } =
      await requireMatchParticipant(ctx, args.matchId);
    await applyMatchResult(ctx, {
      match,
      phase: await requirePhase(ctx, match.tournamentPhaseId),
      round,
      players: [myRow, opponentRow],
      playerOneGameWins: args.myGameWins,
      playerTwoGameWins: args.opponentGameWins,
      gameDraws: args.gameDraws ?? 0,
      policy: {
        kind: "player",
        actor: user,
        reporterRegistrationId: myRow.playerId,
      },
    });
    return match._id;
  },
});

export const dropSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "dropSelf");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      throw new Error("Active registration not found");
    }
    await dropPlayer(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "player",
    });
    return registration._id;
  },
});

// Being one of the match's two players is the authorization — participation
// status is not checked, because a match can outlive it (a drop concedes the
// player's own unfinished match, but never touches a finished one).
async function requireMatchParticipant(
  ctx: MutationCtx,
  matchId: Id<"tournamentMatches">,
) {
  const user = await ensureCurrentUser(ctx);
  const match = await requireMatch(ctx, matchId);
  const tournament = await requireTournament(ctx, match.tournamentId);
  if (tournament.lifecycle !== "in_progress") {
    throw new Error("Tournament is not in progress");
  }
  const round = await requireRound(ctx, match.tournamentRoundId);
  if (!isPairingsVisibleToPlayers(round)) {
    throw new Error("Pairings have not been published");
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

  return {
    match,
    round,
    tournament,
    registration,
    players,
    myRow,
    opponentRow,
    user,
  };
}
