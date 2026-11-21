import { v } from "convex/values";

import { mutation } from "../_generated/server";
import * as timer from "../model/timer";
import { requireMatch, requireOrganizerAccess } from "../model/tournaments";

// Thin adapters over model/timer.ts, which owns each control's validation,
// write, and audit event: the endpoint resolves organizer access and hands
// it over.

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

// Match Time Extensions. Staff access is organization membership, the same
// gate result entry and the round timer use: there is no separate judge role
// yet, so every member who can run the live round can extend a match.
//
// expectedSetAt is the setAt of the extension the caller last saw (null for
// none); when given, a write against a since-changed extension is refused.
const expectedSetAt = v.optional(v.union(v.number(), v.null()));

export const setMatchTimeExtension = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    minutes: v.number(),
    reason: v.optional(v.string()),
    expectedSetAt,
  },
  handler: async (ctx, args) => {
    const match = await requireMatch(ctx, args.matchId);
    const access = await requireOrganizerAccess(ctx, match.tournamentId);
    return await timer.setMatchTimeExtension(ctx, access, match, args);
  },
});

export const clearMatchTimeExtension = mutation({
  args: { matchId: v.id("tournamentMatches"), expectedSetAt },
  handler: async (ctx, args) => {
    const match = await requireMatch(ctx, args.matchId);
    const access = await requireOrganizerAccess(ctx, match.tournamentId);
    return await timer.clearMatchTimeExtension(ctx, access, match, args);
  },
});
