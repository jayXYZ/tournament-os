import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, mutation } from "../_generated/server";
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
  nextTournamentPublicCode,
  validCapacity,
  validRoundCount,
} from "../model/tournaments";
import {
  deleteTestTournamentOperationalDataBatch,
  generateTestResults,
  requireTestConfig,
  seedTestPlayers as seedTestPlayersModel,
} from "../model/testing";
import { tournamentFormatValidator } from "../validators";

export const createTestTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
    format: v.optional(tournamentFormatValidator),
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
    const publicCode = await nextTournamentPublicCode(ctx, now);
    const tournamentId = await ctx.db.insert("tournaments", {
      name: cleanName(args.name ?? "Test Tournament", "Tournament name"),
      publicCode,
      organizationId: args.organizationId,
      createdBy: user._id,
      status: "private",
      startDate: args.startDate ?? now,
      playerCapacity,
      format: args.format ?? "standard",
      isTestEvent: true,
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
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId,
      dummyPlayerCount,
      roundsToGenerate,
      seed: Math.trunc(args.seed ?? now),
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
    const addedCount = await seedTestPlayersModel(
      ctx,
      args.tournamentId,
      args.count,
    );
    return { tournamentId: args.tournamentId, addedCount };
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

type TestTournamentResetArgs = {
  tournamentId: Id<"tournaments">;
  dummyPlayerCount: number;
  roundsToGenerate: number;
  seed: number;
};

// Recreates the phase, config, and seeded players once all operational data
// has been deleted. The config values travel through the reset args because
// the config row itself is deleted along with the rest of the data.
async function finishTestTournamentReset(
  ctx: MutationCtx,
  args: TestTournamentResetArgs,
) {
  const now = Date.now();
  await ctx.db.insert("tournamentPhases", {
    tournamentId: args.tournamentId,
    phaseName: "Phase 1",
    phaseType: SWISS_FORMAT,
    phaseOrder: 1,
    phaseStatus: "upcoming",
    phaseRoundMode: "fixed",
    phaseTotalRounds: args.roundsToGenerate,
    phaseCutoff: null,
    updatedAt: now,
  });
  await ctx.db.insert("tournamentTestConfigs", {
    tournamentId: args.tournamentId,
    dummyPlayerCount: args.dummyPlayerCount,
    roundsToGenerate: args.roundsToGenerate,
    seed: args.seed,
    updatedAt: now,
  });
  await seedTestPlayersModel(ctx, args.tournamentId, args.dummyPlayerCount);
}

export const resetTestTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const config = await requireTestConfig(ctx, args.tournamentId);
    const resetArgs: TestTournamentResetArgs = {
      tournamentId: args.tournamentId,
      dummyPlayerCount: config.dummyPlayerCount,
      roundsToGenerate: config.roundsToGenerate,
      seed: config.seed,
    };
    await ctx.db.patch(args.tournamentId, {
      status: "private",
      updatedAt: Date.now(),
    });

    // Small tournaments clear within one transaction; larger ones continue in
    // self-rescheduled batches to stay within transaction limits.
    if (await deleteTestTournamentOperationalDataBatch(ctx, args.tournamentId)) {
      await finishTestTournamentReset(ctx, resetArgs);
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.tournaments.testing.continueResetTestTournament,
        resetArgs,
      );
    }
    return args.tournamentId;
  },
});

export const continueResetTestTournament = internalMutation({
  args: {
    tournamentId: v.id("tournaments"),
    dummyPlayerCount: v.number(),
    roundsToGenerate: v.number(),
    seed: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await deleteTestTournamentOperationalDataBatch(ctx, args.tournamentId))) {
      await ctx.scheduler.runAfter(
        0,
        internal.tournaments.testing.continueResetTestTournament,
        args,
      );
      return null;
    }
    await finishTestTournamentReset(ctx, args);
    return null;
  },
});
