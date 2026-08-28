import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, mutation } from "../_generated/server";
import { deleteTournamentOperationalDataBatch } from "../model/deletion";
import {
  SWISS_FORMAT,
  type TournamentPhaseInput,
  defaultSwissRoundCount,
  requireCurrentPhase,
  requirePhase,
  requireResolvedPhaseTotalRounds,
  requireSwissPhase,
  validRoundCount,
  writePhases,
} from "../model/phases";
import { advance, pairFirstRoundOfTournament } from "../model/progression";
import { activeRegistrations } from "../model/registrations";
import {
  createTournament as createTournamentModel,
  requireOrganizerAccess,
  requireRound,
  requireTestTournament,
  requireTournament,
  validCapacity,
} from "../model/tournaments";
import {
  generateTestResults,
  requireTestConfig,
  seedTestPlayers as seedTestPlayersModel,
} from "../model/testing";
import { enforceRateLimit } from "../rateLimits";
import { tournamentFormatValidator } from "../validators";

type TestTournamentSeedArgs = {
  tournamentId: Id<"tournaments">;
  dummyPlayerCount: number;
  roundsToGenerate: number;
  seed: number;
};

// The single fixed-length Swiss phase every test tournament plays.
function testPhaseInput(roundsToGenerate: number): TournamentPhaseInput {
  return {
    phaseOrder: 1,
    phaseRoundMode: "fixed",
    phaseTotalRounds: roundsToGenerate,
  };
}

async function seedTestConfigAndPlayers(
  ctx: MutationCtx,
  args: TestTournamentSeedArgs,
) {
  await ctx.db.insert("tournamentTestConfigs", {
    tournamentId: args.tournamentId,
    dummyPlayerCount: args.dummyPlayerCount,
    roundsToGenerate: args.roundsToGenerate,
    seed: args.seed,
    updatedAt: Date.now(),
  });
  await seedTestPlayersModel(ctx, args.tournamentId, args.dummyPlayerCount);
}

// Recreates the phase, config, and seeded players on the reset path, where
// the config values travel through the args because the config row itself is
// deleted along with the rest of the operational data. Creation gets its
// phase from createTournament instead.
async function seedTestTournamentData(
  ctx: MutationCtx,
  args: TestTournamentSeedArgs,
) {
  await writePhases(
    ctx,
    args.tournamentId,
    [testPhaseInput(args.roundsToGenerate)],
    Date.now(),
  );
  await seedTestConfigAndPlayers(ctx, args);
}

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
    const {
      tournamentId,
      phaseIds: [phaseId],
    } = await createTournamentModel(ctx, {
      organizationId: args.organizationId,
      name: args.name ?? "Test Tournament",
      startDate: args.startDate ?? now,
      playerCapacity,
      format: args.format ?? "standard",
      isTestEvent: true,
      // Test events exercise pairing and results flows, not deck collection.
      decklistRequired: false,
      // Unlisted so a running test event is reachable by its public code (the
      // player controller uses it) without ever appearing in public listings.
      visibility: "unlisted",
      // Mirror the test-config seed so pairings are reproducible across runs.
      seed,
      phases: [testPhaseInput(roundsToGenerate)],
    });

    await seedTestConfigAndPlayers(ctx, {
      tournamentId,
      dummyPlayerCount,
      roundsToGenerate,
      seed,
    });

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

export const resetTestTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const config = await requireTestConfig(ctx, args.tournamentId);
    const resetArgs: TestTournamentSeedArgs = {
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
      await seedTestTournamentData(ctx, resetArgs);
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
    await seedTestTournamentData(ctx, args);
    return null;
  },
});
