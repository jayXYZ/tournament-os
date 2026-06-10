import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { ensureCurrentUser } from "../model/users";
import {
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
    if (tournament.status !== "public") {
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

    await requireCapacityAvailable(ctx, tournament);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "active", updatedAt: now });
      return existing._id;
    }

    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId: args.tournamentId,
      userId: user._id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
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

    await ctx.db.patch(registration._id, {
      status: "dropped",
      updatedAt: Date.now(),
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

export const listRegistrations = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(512);

    return await Promise.all(
      registrations.map(async (registration) => ({
        registration,
        user: await ctx.db.get(registration.userId),
      })),
    );
  },
});

export const dropRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    await requireOrganizerAccess(ctx, registration.tournamentId);
    await ctx.db.patch(args.registrationId, {
      status: "dropped",
      updatedAt: Date.now(),
    });
    return args.registrationId;
  },
});

export const reinstateRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    await requireCapacityAvailable(ctx, tournament);
    await ctx.db.patch(args.registrationId, {
      status: "active",
      updatedAt: Date.now(),
    });
    return args.registrationId;
  },
});
