import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, mutation } from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import { deleteTournamentOperationalDataBatch } from "../model/deletion";
import {
  SWISS_FORMAT,
  defaultSwissRoundCount,
  requireCurrentPhase,
  requirePhase,
  requireResolvedPhaseTotalRounds,
  requireSwissPhase,
  validRoundCount,
} from "../model/phases";
import { advance, pairFirstRoundOfTournament } from "../model/progression";
import { activeRegistrations } from "../model/registrations";
import {
  cleanName,
  requireOrganizerAccess,
  requireRound,
  requireTestTournament,
  requireTournament,
  nextTournamentPublicCode,
  validCapacity,
  validStartDate,
} from "../model/tournaments";
import {
  generateTestResults,
  requireTestConfig,
  seedTestPlayers as seedTestPlayersModel,
} from "../model/testing";
import { enforceRateLimit } from "../rateLimits";
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
    await enforceRateLimit(ctx, "createTournament");
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
    const seed = Math.trunc(args.seed ?? now);
    const publicCode = await nextTournamentPublicCode(ctx, now);
    const tournamentId = await ctx.db.insert("tournaments", {
      name: cleanName(args.name ?? "Test Tournament", "Tournament name"),
      publicCode,
      organizationId: args.organizationId,
      createdBy: user._id,
      // Unlisted so a running test event is reachable by its public code (the
      // player controller uses it) without ever appearing in public listings.
      visibility: "unlisted",
      lifecycle: "setup",
      startDate:
        args.startDate === undefined ? now : validStartDate(args.startDate),
      playerCapacity,
      format: args.format ?? "standard",
      isTestEvent: true,
      autoPublishPairings: false,
      // Test events exercise pairing and results flows, not deck collection.
      decklistRequired: false,
      confirmedRegistrationCount: 0,
      // Mirror the test-config seed so pairings are reproducible across runs.
      seed,
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
      powerPairFinalRound: true,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId,
      dummyPlayerCount,
      roundsToGenerate,
      seed,
      updatedAt: now,
    });

    await seedTestPlayersModel(ctx, tournamentId, dummyPlayerCount);

    if (args.autoStart === true) {
      // Test seeding starts play straight from "setup" (the event is never
      // published), so it skips startTournament's gate and audit trail but
      // shares the one first-round pairing sequence with it.
      const tournament = await requireTournament(ctx, tournamentId);
      const phase = await requirePhase(ctx, phaseId);
      await pairFirstRoundOfTournament(ctx, {
        tournament,
        phase,
        registrations: await activeRegistrations(ctx, tournamentId),
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
    await enforceRateLimit(ctx, "seedTestPlayers");
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
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    const { tournament } = access;
    requireTestTournament(tournament);
    const phase = await requireCurrentPhase(ctx, args.tournamentId);
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }
    const round = await requireRound(ctx, phase.phaseCurrentRound);
    await generateTestResults(ctx, tournament, round);

    // The shortcut is the same advance the organizer's board drives —
    // standings, eliminations, timer clear, phase transitions, audit — plus
    // one test policy: stop where the test config's round budget says to
    // (Swiss only; a playoff always plays out its bracket).
    const config = await requireTestConfig(ctx, args.tournamentId);
    const outcome = await advance(ctx, access, {
      completeTournamentAfterRound:
        phase.phaseType === SWISS_FORMAT
          ? Math.min(
              config.roundsToGenerate,
              requireResolvedPhaseTotalRounds(phase),
            )
          : undefined,
    });
    return {
      tournamentId: args.tournamentId,
      roundId:
        outcome.kind === "nextRoundPaired"
          ? outcome.nextRoundId
          : outcome.completedRoundId,
    };
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
    powerPairFinalRound: true,
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
    // Every registration is deleted below and the player set is rebuilt by
    // seedTestPlayers, so the denormalized count resets to zero here.
    await ctx.db.patch(args.tournamentId, {
      lifecycle: "setup",
      confirmedRegistrationCount: 0,
      updatedAt: Date.now(),
    });

    // Small tournaments clear within one transaction; larger ones continue in
    // self-rescheduled batches to stay within transaction limits.
    if (await deleteTournamentOperationalDataBatch(ctx, args.tournamentId)) {
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
    if (!(await deleteTournamentOperationalDataBatch(ctx, args.tournamentId))) {
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
