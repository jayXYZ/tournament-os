import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import { createRoundWithPairings } from "../model/pairing";
import { replaceStandingsForRound } from "../model/standings";
import {
  SWISS_FORMAT,
  activeRegistrations,
  cleanName,
  completeTournament,
  defaultSwissRoundCount,
  requireOrganizerAccess,
  requirePhase,
  requireResolvedPhaseTotalRounds,
  requireRound,
  requireSwissPhase,
  requireTestTournament,
  requireTournament,
  validCapacity,
  validRoundCount,
} from "../model/tournaments";
import {
  deleteTestTournamentOperationalData,
  generateTestResults,
  requireTestConfig,
  seedTestPlayers as seedTestPlayersModel,
} from "../model/testing";

export const createTestTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
    dummyPlayerCount: v.optional(v.number()),
    roundsToGenerate: v.optional(v.number()),
    seed: v.optional(v.number()),
    autoStart: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    const { user } = await requireActiveMembership(ctx, args.organizationId);
    const dummyPlayerCount = validCapacity(args.dummyPlayerCount ?? 8);
    const playerCapacity = validCapacity(
      args.playerCapacity ?? dummyPlayerCount,
    );
    if (dummyPlayerCount > playerCapacity) {
      throw new Error("Dummy player count cannot exceed capacity");
    }

    const now = Date.now();
    const roundsToGenerate = validRoundCount(
      args.roundsToGenerate ?? defaultSwissRoundCount(dummyPlayerCount),
    );
    const tournamentId = await ctx.db.insert("tournaments", {
      name: cleanName(args.name ?? "Test Tournament", "Tournament name"),
      organizationId: args.organizationId,
      createdBy: user._id,
      status: "private",
      startDate: args.startDate ?? now,
      playerCapacity,
      format: SWISS_FORMAT,
      isTestEvent: true,
      createdAt: now,
      updatedAt: now,
    });

    const phaseId = await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseName: "Phase 1",
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds: roundsToGenerate,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId,
      dummyPlayerCount,
      roundsToGenerate,
      seed: Math.trunc(args.seed ?? now),
      createdAt: now,
      updatedAt: now,
    });

    await seedTestPlayersModel(ctx, tournamentId, dummyPlayerCount);

    if (args.autoStart === true) {
      const tournament = await requireTournament(ctx, tournamentId);
      const phase = await requirePhase(ctx, phaseId);
      const roundId = await createRoundWithPairings(ctx, {
        tournament,
        phase,
        roundNumber: 1,
        registrations: await activeRegistrations(ctx, tournamentId),
      });
      await ctx.db.patch(tournamentId, {
        status: "in_progress",
        updatedAt: now,
      });
      await ctx.db.patch(phaseId, {
        phaseStatus: "in_progress",
        phaseCurrentRound: roundId,
        updatedAt: now,
      });
    }

    return tournamentId;
  },
});

export const seedTestPlayers = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    await seedTestPlayersModel(ctx, args.tournamentId, args.count);
    return args.tournamentId;
  },
});

export const generateTestRoundResults = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    roundId: v.optional(v.id("tournamentRounds")),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    const roundId = args.roundId ?? phase.phaseCurrentRound;
    if (!roundId) {
      throw new Error("Current round not found");
    }

    await generateTestResults(
      ctx,
      tournament,
      await requireRound(ctx, roundId),
    );
    return roundId;
  },
});

export const advanceTestRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }

    const round = await requireRound(ctx, phase.phaseCurrentRound);
    await generateTestResults(ctx, tournament, round);
    await replaceStandingsForRound(ctx, tournament, phase, round);
    await ctx.db.patch(round._id, {
      roundStatus: "completed",
      updatedAt: Date.now(),
    });

    const config = await requireTestConfig(ctx, args.tournamentId);
    const finalRound = Math.min(
      config.roundsToGenerate,
      requireResolvedPhaseTotalRounds(phase),
    );
    if (round.roundNumber >= finalRound) {
      await completeTournament(ctx, args.tournamentId);
      return { tournamentId: args.tournamentId, roundId: round._id };
    }

    const nextRoundId = await createRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: round.roundNumber + 1,
      registrations: await activeRegistrations(ctx, args.tournamentId),
      previousRoundId: round._id,
    });
    await ctx.db.patch(phase._id, {
      phaseStatus: "in_progress",
      phaseCurrentRound: nextRoundId,
      updatedAt: Date.now(),
    });
    return { tournamentId: args.tournamentId, roundId: nextRoundId };
  },
});

export const resetTestTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const config = await requireTestConfig(ctx, args.tournamentId);
    await deleteTestTournamentOperationalData(ctx, args.tournamentId);
    const now = Date.now();
    await ctx.db.patch(args.tournamentId, {
      status: "private",
      updatedAt: now,
    });
    await ctx.db.insert("tournamentPhases", {
      tournamentId: args.tournamentId,
      phaseName: "Phase 1",
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds: config.roundsToGenerate,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId: args.tournamentId,
      dummyPlayerCount: config.dummyPlayerCount,
      roundsToGenerate: config.roundsToGenerate,
      seed: config.seed,
      createdAt: now,
      updatedAt: now,
    });
    await seedTestPlayersModel(
      ctx,
      args.tournamentId,
      config.dummyPlayerCount,
    );
    return args.tournamentId;
  },
});
