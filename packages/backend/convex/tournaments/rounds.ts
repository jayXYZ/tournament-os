import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import {
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import {
  requireDecisiveEliminationResult,
  requireCurrentPhase,
  requirePhase,
} from "../model/phases";
import {
  analyzeProgression,
  completeRound as completeRoundTransition,
  generateNextRound as generateNextRoundTransition,
  loadPhaseBoards,
  publishPairings as publishPairingsTransition,
  rewindLatestRound as rewindLatestRoundTransition,
  startTournament as startTournamentTransition,
} from "../model/progression";
import { matchPointsForResult } from "../model/standings";
import {
  MAX_TOURNAMENT_PLAYERS,
  nonActiveParticipationStatuses,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import {
  matchPlayers,
  requireMatch,
  requireOrganizerAccess,
  requireRound,
  roundMatchesWithPlayers,
} from "../model/tournaments";

// Every mutation here is an adapter: auth + args + one call into
// model/progression, which owns the sequencing and the readiness rules.

export const startTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await startTournamentTransition(ctx, access);
  },
});

export const generateNextRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await generateNextRoundTransition(ctx, access);
  },
});

export const publishPairings = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    return await publishPairingsTransition(ctx, args.roundId);
  },
});

export const recordMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    playerOneRegistrationId: v.id("tournamentRegistrations"),
    playerTwoRegistrationId: v.id("tournamentRegistrations"),
    playerOneGameWins: v.number(),
    playerTwoGameWins: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await requireMatch(ctx, args.matchId);
    const { user } = await requireOrganizerAccess(ctx, match.tournamentId);
    const round = await requireRound(ctx, match.tournamentRoundId);
    if (round.roundStatus !== "in_progress") {
      throw new Error(
        "Match results can only be recorded during an active round",
      );
    }
    const phase = await requirePhase(ctx, match.tournamentPhaseId);
    requireDecisiveEliminationResult(
      phase,
      args.playerOneGameWins,
      args.playerTwoGameWins,
    );
    const players = await matchPlayers(ctx, args.matchId);
    if (players.length !== 2) {
      throw new Error("Match result requires exactly two players");
    }

    const playerOne = players.find(
      (player) => player.playerId === args.playerOneRegistrationId,
    );
    const playerTwo = players.find(
      (player) => player.playerId === args.playerTwoRegistrationId,
    );
    if (!playerOne || !playerTwo) {
      throw new Error("Result players must match the pairing");
    }

    const [playerOnePoints, playerTwoPoints] = matchPointsForResult({
      playerOneGameWins: args.playerOneGameWins,
      playerTwoGameWins: args.playerTwoGameWins,
    });
    // Captured before the patches below overwrite the rows: a non-null value
    // means this call edited an existing result, which the log must preserve.
    const previousResult = existingResultLines(match, players);
    const now = Date.now();
    await ctx.db.patch(playerOne._id, {
      matchPointsEarned: playerOnePoints,
      gameWins: args.playerOneGameWins,
      gameLosses: args.playerTwoGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(playerTwo._id, {
      matchPointsEarned: playerTwoPoints,
      gameWins: args.playerTwoGameWins,
      gameLosses: args.playerOneGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(args.matchId, {
      matchStatus: "completed",
      // An organizer-recorded result supersedes any player self-report; this
      // is also the resolution path when players disagree about a result.
      reportedByRegistrationId: undefined,
      updatedAt: now,
    });
    await logAuditEvent(ctx, {
      tournamentId: match.tournamentId,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "match_result_recorded",
        matchId: args.matchId,
        roundNumber: round.roundNumber,
        tableNumber: match.tableNumber ?? null,
        result: [
          auditResultLine(
            playerOne,
            args.playerOneGameWins,
            args.playerTwoGameWins,
          ),
          auditResultLine(
            playerTwo,
            args.playerTwoGameWins,
            args.playerOneGameWins,
          ),
        ],
        previousResult,
      },
    });
    return args.matchId;
  },
});

export const completeRound = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    const access = await requireOrganizerAccess(ctx, round.tournamentId);
    return await completeRoundTransition(ctx, access, args.roundId);
  },
});

export const rewindLatestRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await rewindLatestRoundTransition(ctx, access);
  },
});

export const getCurrentRound = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireCurrentPhase(ctx, tournament._id);
    if (!phase.phaseCurrentRound) {
      return null;
    }

    return await ctx.db.get(phase.phaseCurrentRound);
  },
});

export const listRoundPairings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const matchesWithPlayers = await roundMatchesWithPlayers(ctx, args.roundId);

    // Names come from the denormalized copy on each match-player row; only rows
    // missing it (legacy data) fall back to a live lookup, keeping this query
    // off the per-row user join that would otherwise blow the read budget.
    return await mapAsyncInBatches(
      matchesWithPlayers,
      DATABASE_IO_BATCH_SIZE,
      async ({ match, players }) => {
        const resolvedPlayers = await Promise.all(
          players.map(async (player) => ({
            ...player,
            playerName: await resolveRegistrationDisplayName(
              ctx,
              player.playerName,
              player.playerId,
            ),
          })),
        );
        return { match, players: resolvedPlayers };
      },
    );
  },
});

export const getPairingsBoard = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phaseBoards = await loadPhaseBoards(ctx, args.tournamentId);
    const { nextStep, actions } = await analyzeProgression(ctx, tournament, {
      phaseBoards,
    });

    return {
      tournament,
      phases: phaseBoards,
      nextStep,
      rewind: actions.rewind,
    };
  },
});

export const listRoundStandings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", args.roundId),
      )
      .take(MAX_TOURNAMENT_PLAYERS);

    // Denormalized name on the standings row avoids the per-row user join;
    // legacy rows without one fall back to a live lookup. Registration status
    // stays live-joined here: unlike the player standings query this renders an
    // arbitrary completed round, and only the latest round's rows carry a
    // current denormalized copy. The scan's cost is acceptable because the
    // audience is the event's organizers, not every player in it.
    const nonActiveStatuses = await nonActiveParticipationStatuses(
      ctx,
      round.tournamentId,
    );
    return await mapAsyncInBatches(
      standings,
      DATABASE_IO_BATCH_SIZE,
      async (standing) => ({
        standing,
        playerName: await resolveRegistrationDisplayName(
          ctx,
          standing.playerName,
          standing.playerId,
        ),
        registrationStatus:
          nonActiveStatuses.get(standing.playerId) ?? ("active" as const),
      }),
    );
  },
});
