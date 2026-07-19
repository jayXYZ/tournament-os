import { v } from "convex/values";

import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_TIMER_ADJUST_MS,
  isValidRoundDurationMs,
} from "@tournament-os/shared/timer-utils";

import type { Doc } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { requireCurrentPhase } from "../model/phases";
import {
  isPairingsVisibleToPlayers,
  requireOrganizerAccess,
  requireRound,
} from "../model/tournaments";

// Organizer controls for the tournament's single live round timer (stored on
// the tournament doc, see schema.ts). All writes here are organizer actions —
// the countdown itself ticks client-side against the stored anchors, so there
// are no per-second writes. Overtime is never stored; a running timer whose
// endsAt has passed simply reads as negative remaining time.

export const setRoundDuration = mutation({
  args: { tournamentId: v.id("tournaments"), durationMs: v.number() },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    if (tournament.lifecycle === "cancelled") {
      throw new Error("Tournament has been cancelled");
    }
    await ctx.db.patch(args.tournamentId, {
      roundDurationMs: validDurationMs(args.durationMs),
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

// Starting overwrites any existing timer (restart semantics); the UI gates
// restarting a live timer behind a hold-to-confirm control.
export const startTimer = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const round = await requireTimableCurrentRound(ctx, tournament);
    const durationMs = validDurationMs(
      args.durationMs ??
        tournament.roundDurationMs ??
        DEFAULT_ROUND_DURATION_MS,
    );
    const now = Date.now();
    await ctx.db.patch(tournament._id, {
      roundTimer: {
        kind: "running",
        roundId: round._id,
        startedAt: now,
        durationMs,
        endsAt: now + durationMs,
      },
      updatedAt: now,
    });
    return tournament._id;
  },
});

export const pauseTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const timer = tournament.roundTimer;
    if (timer?.kind !== "running") {
      throw new Error("Timer is not running");
    }
    const now = Date.now();
    await ctx.db.patch(tournament._id, {
      roundTimer: {
        kind: "paused",
        roundId: timer.roundId,
        startedAt: timer.startedAt,
        durationMs: timer.durationMs,
        // Negative when pausing in overtime; resume picks up mid-overtime.
        remainingMs: timer.endsAt - now,
      },
      updatedAt: now,
    });
    return tournament._id;
  },
});

export const resumeTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const timer = tournament.roundTimer;
    if (timer?.kind !== "paused") {
      throw new Error("Timer is not paused");
    }
    const now = Date.now();
    await ctx.db.patch(tournament._id, {
      roundTimer: {
        kind: "running",
        roundId: timer.roundId,
        startedAt: timer.startedAt,
        durationMs: timer.durationMs,
        endsAt: now + timer.remainingMs,
      },
      updatedAt: now,
    });
    return tournament._id;
  },
});

export const adjustTimer = mutation({
  args: { tournamentId: v.id("tournaments"), deltaMs: v.number() },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const timer = tournament.roundTimer;
    if (!timer) {
      throw new Error("No timer to adjust");
    }
    if (
      !Number.isInteger(args.deltaMs) ||
      args.deltaMs === 0 ||
      Math.abs(args.deltaMs) > MAX_TIMER_ADJUST_MS
    ) {
      throw new Error("Invalid timer adjustment");
    }
    const durationMs = Math.max(timer.durationMs + args.deltaMs, 0);
    await ctx.db.patch(tournament._id, {
      roundTimer:
        timer.kind === "running"
          ? { ...timer, endsAt: timer.endsAt + args.deltaMs, durationMs }
          : {
              ...timer,
              remainingMs: timer.remainingMs + args.deltaMs,
              durationMs,
            },
      updatedAt: Date.now(),
    });
    return tournament._id;
  },
});

export const clearTimer = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    // Idempotent: clearing an absent timer is a no-op, not an error.
    if (tournament.roundTimer) {
      await ctx.db.patch(tournament._id, {
        roundTimer: undefined,
        updatedAt: Date.now(),
      });
    }
    return tournament._id;
  },
});

function validDurationMs(value: number) {
  if (!isValidRoundDurationMs(value)) {
    throw new Error("Invalid round duration");
  }
  return value;
}

async function requireTimableCurrentRound(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  if (tournament.lifecycle !== "in_progress") {
    throw new Error("Tournament is not in progress");
  }
  const phase = await requireCurrentPhase(ctx, tournament._id);
  if (!phase.phaseCurrentRound) {
    throw new Error("No round is in progress");
  }
  const round = await requireRound(ctx, phase.phaseCurrentRound);
  if (round.roundStatus !== "in_progress") {
    throw new Error("No round is in progress");
  }
  if (!isPairingsVisibleToPlayers(round)) {
    throw new Error("Pairings have not been published");
  }
  return round;
}
