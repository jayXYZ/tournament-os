import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import { ensureCurrentUser } from "../model/users";
import {
  adjustActiveRegistrationCount,
  playerDisplayName,
  registrationForUser,
  requireCapacityAvailable,
  requireOrganizerAccess,
  requireRegistration,
  requireSetupEditable,
  requireTournament,
} from "../model/tournaments";

export const registerSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (
      tournament.lifecycle !== "registration" ||
      tournament.visibility === "private"
    ) {
      throw new Error("Tournament is not open for registration");
    }

    const existing = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (existing && existing.status !== "dropped") {
      throw new Error("Already registered");
    }

    requireCapacityAvailable(tournament);
    const now = Date.now();
    const playerName = playerDisplayName(user);
    const registrationId =
      existing?._id ??
      (await ctx.db.insert("tournamentRegistrations", {
        tournamentId: args.tournamentId,
        userId: user._id,
        status: "active",
        playerName,
        createdAt: now,
        updatedAt: now,
      }));
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        playerName,
        updatedAt: now,
      });
    }
    await adjustActiveRegistrationCount(ctx, tournament, 1, now);
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: "player_registered",
        player: { registrationId, playerName: playerName ?? null },
      },
    });
    return registrationId;
  },
});

export const cancelMyRegistration = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration || registration.status !== "active") {
      throw new Error("Active registration not found");
    }

    const now = Date.now();
    await ctx.db.patch(registration._id, {
      status: "dropped",
      updatedAt: now,
    });
    await adjustActiveRegistrationCount(ctx, tournament, -1, now);
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: "registration_cancelled",
        player: auditPlayerRef(registration),
      },
    });
    return registration._id;
  },
});

export const getMyRegistration = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }

    return await registrationForUser(ctx, args.tournamentId, user._id);
  },
});

export const listMyTournaments = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return [];
    }

    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .take(100);

    const rows = [];
    for (const registration of registrations) {
      const tournament = await ctx.db.get(registration.tournamentId);
      if (
        !tournament ||
        (tournament.lifecycle !== "registration" &&
          tournament.lifecycle !== "in_progress")
      ) {
        continue;
      }
      const organization = await ctx.db.get(tournament.organizationId);
      rows.push({
        registration,
        tournament,
        organizationName: organization?.name ?? null,
        registeredCount: tournament.activeRegistrationCount,
      });
    }

    rows.sort((left, right) => left.tournament.startDate - right.tournament.startDate);
    return rows;
  },
});

export const listRegistrations = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    // Collects all statuses: dropped rows persist and can push the total past
    // capacity, so a MAX_TOURNAMENT_PLAYERS cap would hide the newest entrants
    // from the organizer list. Scoped to one tournament via an equality index.
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Names come from the denormalized copy on the registration; only rows
    // missing it (legacy data) fall back to a live user lookup, so the common
    // path does zero per-row joins.
    return await Promise.all(
      registrations.map(async (registration) => ({
        registration,
        playerName:
          registration.playerName ??
          playerDisplayName(await ctx.db.get(registration.userId)),
      })),
    );
  },
});

export const dropRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    const now = Date.now();
    await ctx.db.patch(args.registrationId, {
      status: "dropped",
      updatedAt: now,
    });
    if (registration.status === "active") {
      await adjustActiveRegistrationCount(ctx, tournament, -1, now);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: { type: "player_dropped", player: auditPlayerRef(registration) },
    });
    return args.registrationId;
  },
});

export const reinstateRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    requireCapacityAvailable(tournament);
    const now = Date.now();
    await ctx.db.patch(args.registrationId, {
      status: "active",
      updatedAt: now,
    });
    if (registration.status !== "active") {
      await adjustActiveRegistrationCount(ctx, tournament, 1, now);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "player_reinstated",
        player: auditPlayerRef(registration),
      },
    });
    return args.registrationId;
  },
});
