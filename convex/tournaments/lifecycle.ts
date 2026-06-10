import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import {
  SWISS_FORMAT,
  cleanName,
  completeTournament as completeTournamentModel,
  createTournament as createTournamentModel,
  defaultSwissRoundCount,
  requireOrganizerAccess,
  requireSetupEditable,
  requireSwissPhase,
  validCapacity,
  validPhaseInputs,
  validRoundCount,
} from "../model/tournaments";
import { tournamentPhaseRoundModeValidator } from "../validators";

export const listForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);

    return await ctx.db
      .query("tournaments")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(100);
  },
});

export const listUpcomingPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_status_and_startDate", (q) =>
        q.eq("status", "public").gte("startDate", Date.now()),
      )
      .order("asc")
      .take(100);
  },
});

export const listUpcomingForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);

    const now = Date.now();
    const rows = [];
    for (const status of ["private", "public", "in_progress"] as const) {
      const tournaments = await ctx.db
        .query("tournaments")
        .withIndex("by_organizationId_and_status_and_startDate", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("status", status)
            .gte("startDate", now),
        )
        .order("asc")
        .take(100);
      rows.push(...tournaments);
    }

    rows.sort((left, right) => left.startDate - right.startDate);
    return rows.slice(0, 100);
  },
});

export const getTournamentSetup = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phases = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(16);
    const testConfig = await ctx.db
      .query("tournamentTestConfigs")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();

    return { tournament, phases, testConfig };
  },
});

export const createTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentModel(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      isTestEvent: false,
      playerCapacity: args.playerCapacity,
      phases: validPhaseInputs([{ phaseOrder: 1, phaseRoundMode: "dynamic" }]),
    });
  },
});

export const createTournamentWithPhases = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
    isTestEvent: v.optional(v.boolean()),
    phases: v.array(
      v.object({
        phaseOrder: v.number(),
        phaseRoundMode: tournamentPhaseRoundModeValidator,
        phaseTotalRounds: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentModel(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      playerCapacity: args.playerCapacity,
      isTestEvent: args.isTestEvent ?? false,
      phases: validPhaseInputs(args.phases),
    });
  },
});

export const updateTournamentSetup = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);

    const patch: Partial<Doc<"tournaments">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      patch.name = cleanName(args.name, "Tournament name");
    }
    if (args.startDate !== undefined) {
      patch.startDate = args.startDate;
    }
    if (args.playerCapacity !== undefined) {
      patch.playerCapacity = validCapacity(args.playerCapacity);
    }

    await ctx.db.patch(args.tournamentId, patch);
    return args.tournamentId;
  },
});

export const configureSwissPhase = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    phaseTotalRounds: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentPhases">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const now = Date.now();
    const phaseTotalRounds = validRoundCount(
      args.phaseTotalRounds ??
        defaultSwissRoundCount(tournament.playerCapacity),
    );
    const existing = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("phaseOrder", 1),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        phaseType: SWISS_FORMAT,
        phaseStatus: "upcoming",
        phaseRoundMode: "fixed",
        phaseTotalRounds,
        phaseCutoff: null,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("tournamentPhases", {
      tournamentId: args.tournamentId,
      phaseName: "Phase 1",
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds,
      phaseCutoff: null,
      updatedAt: now,
    });
  },
});

export const publishTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    await requireSwissPhase(ctx, args.tournamentId);

    await ctx.db.patch(args.tournamentId, {
      status: "public",
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

export const cancelTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    await ctx.db.patch(args.tournamentId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

export const completeTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await completeTournamentModel(ctx, args.tournamentId);
    return args.tournamentId;
  },
});
