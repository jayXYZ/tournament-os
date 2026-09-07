import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireOrganizerAccess } from "../model/tournaments";
import * as timer from "../model/timer";

export const setRoundDuration = mutation({
  args: { tournamentId: v.id("tournaments"), durationMs: v.number() },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.setRoundDuration(ctx, access, args);
  },
});

export const startTimer = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.startTimer(ctx, access, args);
  },
});

export const pauseTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.pauseTimer(ctx, access);
  },
});

export const resumeTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.resumeTimer(ctx, access);
  },
});

export const adjustTimer = mutation({
  args: { tournamentId: v.id("tournaments"), deltaMs: v.number() },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.adjustTimer(ctx, access, args);
  },
});

export const clearTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const access = await requireOrganizerAccess(ctx, args.tournamentId);
    return await timer.clearTimer(ctx, access);
  },
});
