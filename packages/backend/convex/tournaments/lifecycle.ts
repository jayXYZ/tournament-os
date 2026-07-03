import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { currentUserOrNull, requireActiveMembership } from "../model/access";
import { parsePublicCode } from "../model/publicCodes";
import {
  SWISS_FORMAT,
  cleanName,
  completeTournament as completeTournamentModel,
  createTournament as createTournamentModel,
  defaultSwissRoundCount,
  isPubliclyViewable,
  registrationForUser,
  requireOrganizerAccess,
  requirePhase,
  requireSetupEditable,
  requireSwissPhase,
  validCapacity,
  validPhaseInputs,
  validRoundCount,
} from "../model/tournaments";
import {
  tournamentFormatValidator,
  tournamentPhaseRoundModeValidator,
  tournamentVisibilityValidator,
} from "../validators";

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
    const tournaments = await ctx.db
      .query("tournaments")
      .withIndex("by_visibility_and_lifecycle_and_startDate", (q) =>
        q
          .eq("visibility", "public")
          .eq("lifecycle", "registration")
          .gte("startDate", Date.now()),
      )
      .order("asc")
      .take(100);

    const rows = [];
    for (const tournament of tournaments) {
      const organization = await ctx.db.get(tournament.organizationId);
      rows.push({
        ...tournament,
        organizationName: organization?.name ?? null,
        registeredCount: tournament.activeRegistrationCount,
      });
    }

    return rows;
  },
});

export const listUpcomingForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);

    const now = Date.now();
    const rows = [];
    for (const lifecycle of ["setup", "registration", "in_progress"] as const) {
      const tournaments = await ctx.db
        .query("tournaments")
        .withIndex("by_organizationId_and_lifecycle_and_startDate", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("lifecycle", lifecycle)
            .gte("startDate", now),
        )
        .order("asc")
        .take(100);
      rows.push(...tournaments);
    }

    rows.sort((left, right) => left.startDate - right.startDate);
    const limited = rows.slice(0, 100);
    return limited.map((tournament) => ({
      ...tournament,
      registeredCount: tournament.activeRegistrationCount,
    }));
  },
});

// Takes the code as a plain string because it arrives from a public URL; an
// unrecognized or malformed code returns null instead of throwing, as does a
// private event unless the caller is registered for it.
export const getPublicTournament = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const publicCode = parsePublicCode(args.publicCode);
    if (publicCode === null) {
      return null;
    }

    const tournament = await ctx.db
      .query("tournaments")
      .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
      .unique();
    if (!tournament) {
      return null;
    }
    // Going private only removes the event from public discovery. Registered
    // players must still resolve the code, or flipping a live event to
    // private would lock them out of pairings and result reporting. Setup
    // events stay hidden: registrations only exist after publish.
    if (!isPubliclyViewable(tournament)) {
      const user = await currentUserOrNull(ctx);
      const registration = user
        ? await registrationForUser(ctx, tournament._id, user._id)
        : null;
      if (!registration) {
        return null;
      }
    }

    const organization = await ctx.db.get(tournament.organizationId);
    return {
      tournament,
      organizationName: organization?.name ?? null,
      registeredCount: tournament.activeRegistrationCount,
    };
  },
});

// Resolves a public code to the tournament an organizer manages. The admin URLs
// carry the public code (not the Convex id) so organizers and players see the
// same identifier; this maps it back to the document for access-checked reads.
// Returns null for malformed or unknown codes; throws if the caller lacks
// organizer access, matching getTournamentSetup.
export const getManagedTournament = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const publicCode = parsePublicCode(args.publicCode);
    if (publicCode === null) {
      return null;
    }

    const found = await ctx.db
      .query("tournaments")
      .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
      .unique();
    if (!found) {
      return null;
    }

    const { tournament } = await requireOrganizerAccess(ctx, found._id);
    return { tournament };
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
    format: tournamentFormatValidator,
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentModel(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      isTestEvent: false,
      playerCapacity: args.playerCapacity,
      format: args.format,
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
    format: tournamentFormatValidator,
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
      format: args.format,
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
    format: v.optional(tournamentFormatValidator),
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
    if (args.format !== undefined) {
      patch.format = args.format;
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

export const updatePhaseSetup = mutation({
  args: {
    phaseId: v.id("tournamentPhases"),
    phaseRoundMode: tournamentPhaseRoundModeValidator,
    phaseTotalRounds: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentPhases">> => {
    const phase = await requirePhase(ctx, args.phaseId);
    const { tournament } = await requireOrganizerAccess(
      ctx,
      phase.tournamentId,
    );
    requireSetupEditable(tournament);

    const phaseTotalRounds =
      args.phaseRoundMode === "fixed"
        ? validRoundCount(
            args.phaseTotalRounds ??
              phase.phaseTotalRounds ??
              defaultSwissRoundCount(tournament.playerCapacity),
          )
        : null;

    await ctx.db.patch(args.phaseId, {
      phaseRoundMode: args.phaseRoundMode,
      phaseTotalRounds,
      updatedAt: Date.now(),
    });
    return args.phaseId;
  },
});

export const publishTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    await requireSwissPhase(ctx, args.tournamentId);

    await ctx.db.patch(args.tournamentId, {
      lifecycle: "registration",
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

// Visibility can change at any point in the lifecycle: an organizer may hide a
// finished event or take a live one off the public listings.
export const updateTournamentVisibility = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    visibility: tournamentVisibilityValidator,
  },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    await ctx.db.patch(args.tournamentId, {
      visibility: args.visibility,
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
      lifecycle: "cancelled",
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
