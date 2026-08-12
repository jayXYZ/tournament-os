import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { applyMatchResult } from "../model/matchResults";
import { requireCurrentPhase, requirePhase } from "../model/phases";
import {
  analyzeProgression,
  completeRound as completeRoundTransition,
  generateNextRound as generateNextRoundTransition,
  loadPhaseBoards,
  publishPairings as publishPairingsTransition,
  rewindLatestRound as rewindLatestRoundTransition,
  startTournament as startTournamentTransition,
} from "../model/progression";
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
    gameDraws: v.optional(v.number()),
    // Optional note explaining a correction, stored on the result revision.
    note: v.optional(v.string()),
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
    const players = await matchPlayers(ctx, args.matchId);
    const playerOne = players.find(
      (player) => player.playerId === args.playerOneRegistrationId,
    );
    const playerTwo = players.find(
      (player) => player.playerId === args.playerTwoRegistrationId,
    );
    if (!playerOne || !playerTwo) {
      throw new Error("Result players must match the pairing");
    }
    await applyMatchResult(ctx, {
      match,
      phase: await requirePhase(ctx, match.tournamentPhaseId),
      round,
      players: [playerOne, playerTwo],
      playerOneGameWins: args.playerOneGameWins,
      playerTwoGameWins: args.playerTwoGameWins,
      gameDraws: args.gameDraws ?? 0,
      policy: { kind: "organizer", actor: user, note: cleanNote(args.note) },
    });
    return args.matchId;
  },
});

// Empty and whitespace-only notes are dropped rather than stored.
function cleanNote(note: string | undefined) {
  const trimmed = note?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > 500) {
    throw new Error("Result note must be at most 500 characters");
  }
  return trimmed;
}

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
