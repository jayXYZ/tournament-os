import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";
import {
  currentUserOrNull,
  getActiveMembership,
  requireActiveMembership,
} from "../model/access";
import { logAuditEvent } from "../model/auditLog";
import { deleteTournamentOperationalDataBatch } from "../model/deletion";
import {
  SINGLE_ELIMINATION_FORMAT,
  SWISS_FORMAT,
  requireSwissPhase,
  validPhaseInputs,
} from "../model/phases";
import { parsePublicCode } from "../model/publicCodes";
import {
  MAX_TOURNAMENT_PLAYERS,
  registrationForUser,
} from "../model/registrations";
import {
  cleanName,
  completeTournament as completeTournamentModel,
  createTournament as createTournamentModel,
  isPubliclyViewable,
  requireOrganizerAccess,
  requirePreStartEditable,
  requireSetupEditable,
  validCapacity,
  validDetailsMarkdown,
} from "../model/tournaments";
import {
  tournamentFormatValidator,
  tournamentPhaseRoundModeValidator,
  tournamentPhaseTypeValidator,
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
    // Setup events stay hidden from everyone except the organizing team, even
    // if test data or an organizer-created row already registered a player.
    // After publication, going private only removes public access: registered
    // players must still resolve the code or a live visibility change would
    // lock them out of pairings and result reporting.
    if (!isPubliclyViewable(tournament)) {
      const user = await currentUserOrNull(ctx);
      const membership = user
        ? await getActiveMembership(ctx, tournament.organizationId, user._id)
        : null;
      const registration =
        tournament.lifecycle !== "setup" && !membership && user
          ? await registrationForUser(ctx, tournament._id, user._id)
          : null;
      if (!membership && !registration) {
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
        phaseType: v.optional(tournamentPhaseTypeValidator),
        phaseRoundMode: tournamentPhaseRoundModeValidator,
        phaseTotalRounds: v.optional(v.number()),
        playerMeeting: v.optional(v.boolean()),
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
    requirePreStartEditable(tournament);

    const patch: Partial<Doc<"tournaments">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      patch.name = cleanName(args.name, "Tournament name");
    }
    if (args.startDate !== undefined) {
      patch.startDate = args.startDate;
    }
    if (args.playerCapacity !== undefined) {
      const playerCapacity = validCapacity(args.playerCapacity);
      if (playerCapacity < tournament.activeRegistrationCount) {
        throw new Error(
          "Player capacity cannot be lower than the active registration count",
        );
      }
      patch.playerCapacity = playerCapacity;
    }
    if (args.format !== undefined) {
      patch.format = args.format;
    }

    await ctx.db.patch(args.tournamentId, patch);
    return args.tournamentId;
  },
});

// This preference remains editable while play is underway because it only
// controls rounds generated after the change. Already generated rounds keep
// their explicit publication state.
export const updatePairingsAutoPublish = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    autoPublishPairings: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    if (
      tournament.lifecycle === "completed" ||
      tournament.lifecycle === "cancelled"
    ) {
      throw new Error("Tournament is no longer editable");
    }
    await ctx.db.patch(tournament._id, {
      autoPublishPairings: args.autoPublishPairings,
      updatedAt: Date.now(),
    });
    return tournament._id;
  },
});

// Unlike updateTournamentSetup, details stay editable through the whole
// lifecycle: organizers legitimately update prize or logistics info while an
// event is in registration or already running. Cancelled events are the one
// exception — they are read-only, matching the settings UI.
export const updateTournamentDetails = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    detailsMarkdown: v.string(),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    if (tournament.lifecycle === "cancelled") {
      throw new Error("Tournament has been cancelled");
    }
    await ctx.db.patch(args.tournamentId, {
      detailsMarkdown: validDetailsMarkdown(args.detailsMarkdown),
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

async function clearPlayerMeetingSnapshot(
  ctx: MutationCtx,
  phaseId: Id<"tournamentPhases">,
) {
  const seats = await ctx.db
    .query("playerMeetingSeats")
    .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
      q.eq("tournamentPhaseId", phaseId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  for (const seat of seats) {
    await ctx.db.delete(seat._id);
  }
}

export const updateTournamentPhases = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    phases: v.array(
      v.object({
        phaseId: v.optional(v.id("tournamentPhases")),
        phaseOrder: v.number(),
        phaseType: tournamentPhaseTypeValidator,
        phaseRoundMode: tournamentPhaseRoundModeValidator,
        phaseTotalRounds: v.optional(v.number()),
        playerMeeting: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"tournamentPhases">[]> => {
    const { tournament } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    requirePreStartEditable(tournament);

    const validatedPhases = validPhaseInputs(
      args.phases.map(({ phaseId: _phaseId, ...phase }) => phase),
    );
    const existingPhases = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(16);
    const existingById = new Map(
      existingPhases.map((phase) => [phase._id, phase]),
    );
    const requestedExistingIds = new Set<Id<"tournamentPhases">>();

    for (const requested of args.phases) {
      if (requested.phaseId === undefined) {
        continue;
      }
      if (requestedExistingIds.has(requested.phaseId)) {
        throw new Error("Tournament phase IDs must be unique");
      }
      if (!existingById.has(requested.phaseId)) {
        throw new Error("Tournament phase does not belong to this tournament");
      }
      requestedExistingIds.add(requested.phaseId);
    }

    const now = Date.now();
    for (const existing of existingPhases) {
      if (requestedExistingIds.has(existing._id)) {
        continue;
      }
      if (existing.playerMeetingStatus !== undefined) {
        await clearPlayerMeetingSnapshot(ctx, existing._id);
      }
      await ctx.db.delete(existing._id);
    }

    const orderedPhaseIds: Id<"tournamentPhases">[] = [];
    for (const [index, phase] of validatedPhases.entries()) {
      const requested = args.phases[index];
      const existing =
        requested.phaseId === undefined
          ? undefined
          : existingById.get(requested.phaseId);
      const resetMeeting =
        existing?.playerMeetingStatus !== undefined &&
        (phase.phaseOrder !== 1 ||
          phase.phaseType === SINGLE_ELIMINATION_FORMAT ||
          phase.playerMeeting !== true);

      if (existing && resetMeeting) {
        await clearPlayerMeetingSnapshot(ctx, existing._id);
      }

      const phaseFields = {
        phaseName: `Phase ${phase.phaseOrder}`,
        phaseType: phase.phaseType,
        phaseOrder: phase.phaseOrder,
        phaseStatus: "upcoming" as const,
        phaseRoundMode: phase.phaseRoundMode,
        phaseTotalRounds: phase.phaseTotalRounds,
        phaseCurrentRound: undefined,
        phaseCutoff: null,
        powerPairFinalRound:
          phase.phaseType === SWISS_FORMAT ? true : undefined,
        playerMeeting: phase.playerMeeting,
        ...(resetMeeting ? { playerMeetingStatus: undefined } : {}),
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, phaseFields);
        orderedPhaseIds.push(existing._id);
      } else {
        orderedPhaseIds.push(
          await ctx.db.insert("tournamentPhases", {
            tournamentId: args.tournamentId,
            ...phaseFields,
          }),
        );
      }
    }

    await ctx.db.patch(args.tournamentId, { updatedAt: now });
    return orderedPhaseIds;
  },
});

export const publishTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    requireSetupEditable(tournament);
    await requireSwissPhase(ctx, args.tournamentId);

    await ctx.db.patch(args.tournamentId, {
      lifecycle: "registration",
      updatedAt: Date.now(),
    });
    await logAuditEvent(ctx, {
      tournamentId: args.tournamentId,
      actor: user,
      actorRole: "organizer",
      event: { type: "tournament_published" },
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
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    if (tournament.lifecycle === "completed") {
      throw new Error("Completed tournaments cannot be cancelled");
    }
    if (tournament.lifecycle === "cancelled") {
      throw new Error("Tournament is already cancelled");
    }
    await ctx.db.patch(args.tournamentId, {
      lifecycle: "cancelled",
      // A cancelled event has no live round, so any running timer dies with it.
      roundTimer: undefined,
      updatedAt: Date.now(),
    });
    await logAuditEvent(ctx, {
      tournamentId: args.tournamentId,
      actor: user,
      actorRole: "organizer",
      event: { type: "tournament_cancelled" },
    });
    return args.tournamentId;
  },
});

// Permanently deletes a tournament and every child row (registrations, phases,
// rounds, matches, match players, standings, test data). Allowed from any
// lifecycle state — the client gates this behind a type-the-name confirmation.
// The tournament is immediately cancelled and hidden so it disappears from all
// public surfaces while large events drain in scheduled batches; the tournament
// row itself is deleted last so live subscriptions resolve gracefully.
export const deleteTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    await ctx.db.patch(args.tournamentId, {
      lifecycle: "cancelled",
      visibility: "private",
      updatedAt: Date.now(),
    });

    // Small tournaments clear within one transaction; larger ones continue in
    // self-rescheduled batches to stay within transaction limits.
    if (await deleteTournamentOperationalDataBatch(ctx, args.tournamentId)) {
      await ctx.db.delete(args.tournamentId);
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.tournaments.lifecycle.continueDeleteTournament,
        { tournamentId: args.tournamentId },
      );
    }
    return args.tournamentId;
  },
});

export const continueDeleteTournament = internalMutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.tournamentId))) {
      return null;
    }
    if (!(await deleteTournamentOperationalDataBatch(ctx, args.tournamentId))) {
      await ctx.scheduler.runAfter(
        0,
        internal.tournaments.lifecycle.continueDeleteTournament,
        args,
      );
      return null;
    }
    await ctx.db.delete(args.tournamentId);
    return null;
  },
});

export const completeTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await completeTournamentModel(ctx, args.tournamentId);
    return args.tournamentId;
  },
});
