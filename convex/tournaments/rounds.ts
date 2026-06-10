import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { createRoundWithPairings } from "../model/pairing";
import {
  matchPointsForResult,
  replaceStandingsForRound,
} from "../model/standings";
import {
  activeRegistrations,
  matchPlayers,
  pairingsNextStep,
  requireMatch,
  requireOrganizerAccess,
  requireResolvedPhaseTotalRounds,
  requireRound,
  requireSetupEditable,
  requireSwissPhase,
  resolvePhaseTotalRounds,
  roundMatches,
} from "../model/tournaments";

export const startTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    const registrations = await activeRegistrations(ctx, args.tournamentId);
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }
    const phaseTotalRounds = await resolvePhaseTotalRounds(
      ctx,
      phase,
      registrations.length,
    );
    const playablePhase = { ...phase, phaseTotalRounds };

    const roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase: playablePhase,
      roundNumber: 1,
      registrations,
    });
    const now = Date.now();
    await ctx.db.patch(tournament._id, {
      status: "in_progress",
      updatedAt: now,
    });
    await ctx.db.patch(playablePhase._id, {
      phaseStatus: "in_progress",
      phaseCurrentRound: roundId,
      updatedAt: now,
    });

    return roundId;
  },
});

export const generateNextRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    if (tournament.status !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }

    const currentRound = await requireRound(ctx, phase.phaseCurrentRound);
    if (currentRound.roundStatus !== "completed") {
      throw new Error("Current round must be completed first");
    }
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    if (currentRound.roundNumber >= phaseTotalRounds) {
      throw new Error("All configured rounds have been generated");
    }

    const roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: currentRound.roundNumber + 1,
      registrations: await activeRegistrations(ctx, args.tournamentId),
      previousRoundId: currentRound._id,
    });
    await ctx.db.patch(phase._id, {
      phaseCurrentRound: roundId,
      updatedAt: Date.now(),
    });
    return roundId;
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
    await requireOrganizerAccess(ctx, match.tournamentId);
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
      updatedAt: now,
    });
    return args.matchId;
  },
});

export const completeRound = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    const { tournament } = await requireOrganizerAccess(
      ctx,
      round.tournamentId,
    );
    const phase = await requireSwissPhase(ctx, round.tournamentId);
    const matches = await roundMatches(ctx, args.roundId);
    for (const match of matches) {
      if (
        match.matchStatus !== "completed" &&
        match.matchStatus !== "confirmed"
      ) {
        throw new Error("All matches need results before completing the round");
      }
    }

    await replaceStandingsForRound(ctx, tournament, phase, round);
    const now = Date.now();
    await ctx.db.patch(args.roundId, {
      roundStatus: "completed",
      updatedAt: now,
    });
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    if (round.roundNumber >= phaseTotalRounds) {
      await ctx.db.patch(phase._id, {
        phaseStatus: "completed",
        updatedAt: now,
      });
    }
    return args.roundId;
  },
});

export const getCurrentRound = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireSwissPhase(ctx, tournament._id);
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
    const matches = await roundMatches(ctx, args.roundId);

    return await Promise.all(
      matches.map(async (match) => {
        const players = await Promise.all(
          (await matchPlayers(ctx, match._id)).map(async (player) => {
            const registration = await ctx.db.get(player.playerId);
            const user = registration
              ? await ctx.db.get(registration.userId)
              : null;
            return { ...player, user };
          }),
        );
        return { match, players };
      }),
    );
  },
});

export const getPairingsBoard = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phases = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(16);

    const phaseBoards = await Promise.all(
      phases.map(async (phase) => ({
        phase,
        rounds: await ctx.db
          .query("tournamentRounds")
          .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
            q.eq("tournamentPhaseId", phase._id),
          )
          .take(64),
      })),
    );

    return {
      tournament,
      phases: phaseBoards,
      nextStep: await pairingsNextStep(ctx, tournament),
    };
  },
});

export const getStandings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    return await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", args.roundId),
      )
      .take(512);
  },
});
