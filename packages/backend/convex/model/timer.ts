import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_TIMER_ADJUST_MS,
  isValidRoundDurationMs,
} from "@paper-pairings/shared/timer-utils";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAuditEvent, type TournamentAuditEvent } from "./auditLog";
import { userError } from "./errors";
import { requireCurrentPhase } from "./phases";
import {
  type TournamentAccess,
  isPairingsVisibleToPlayers,
  requireRound,
} from "./tournaments";

// The organizer controls for the tournament's single live round timer
// (stored on the tournament doc, see schema.ts). Every write here is an
// organizer action — the countdown itself ticks client-side against the
// stored anchors, so there are no per-second writes. Overtime is never
// stored; a running timer whose endsAt has passed simply reads as negative
// remaining time.
//
// Each control owns its validation, the write, and its audit event (see
// docs/audit-policy.md): one round_timer_changed row per change, carrying the
// timer before and after. Lifecycle-driven cleanup (completeRound, rewind,
// cancel) is not a control and stays inside the enclosing lifecycle event.

type TimerOperation = Extract<
  TournamentAuditEvent,
  { type: "round_timer_changed" }
>["operation"];

async function writeTimer(
  ctx: MutationCtx,
  { tournament, user }: TournamentAccess,
  operation: TimerOperation,
  roundTimer: Doc<"tournaments">["roundTimer"],
  now: number,
) {
  // Patching undefined removes the field (clearTimer).
  await ctx.db.patch(tournament._id, { roundTimer, updatedAt: now });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "round_timer_changed",
      operation,
      previousTimer: tournament.roundTimer ?? null,
      timer: roundTimer ?? null,
    },
  });
}

// The default length new timers start with. Re-saving the current value is
// a no-op, so it writes and logs nothing.
export async function setRoundDuration(
  ctx: MutationCtx,
  access: TournamentAccess,
  args: { durationMs: number },
) {
  const { tournament, user } = access;
  if (tournament.lifecycle === "cancelled") {
    throw userError("Tournament has been cancelled");
  }
  const durationMs = validDurationMs(args.durationMs);
  if (durationMs === tournament.roundDurationMs) {
    return tournament._id;
  }
  await ctx.db.patch(tournament._id, {
    roundDurationMs: durationMs,
    updatedAt: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "round_duration_changed",
      previousDurationMs: tournament.roundDurationMs ?? null,
      durationMs,
    },
  });
  return tournament._id;
}

// Starting overwrites any existing timer (restart semantics); the UI gates
// restarting a live timer behind a hold-to-confirm control.
export async function startTimer(
  ctx: MutationCtx,
  access: TournamentAccess,
  args: { durationMs?: number },
) {
  const { tournament } = access;
  const round = await requireTimableCurrentRound(ctx, tournament);
  const durationMs = validDurationMs(
    args.durationMs ?? tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS,
  );
  const now = Date.now();
  await writeTimer(
    ctx,
    access,
    "started",
    {
      kind: "running",
      roundId: round._id,
      startedAt: now,
      durationMs,
      endsAt: now + durationMs,
    },
    now,
  );
  return tournament._id;
}

export async function pauseTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  const timer = tournament.roundTimer;
  if (timer?.kind !== "running") {
    throw userError("Timer is not running");
  }
  const now = Date.now();
  await writeTimer(
    ctx,
    access,
    "paused",
    {
      kind: "paused",
      roundId: timer.roundId,
      startedAt: timer.startedAt,
      durationMs: timer.durationMs,
      // Negative when pausing in overtime; resume picks up mid-overtime.
      remainingMs: timer.endsAt - now,
    },
    now,
  );
  return tournament._id;
}

export async function resumeTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  const timer = tournament.roundTimer;
  if (timer?.kind !== "paused") {
    throw userError("Timer is not paused");
  }
  const now = Date.now();
  await writeTimer(
    ctx,
    access,
    "resumed",
    {
      kind: "running",
      roundId: timer.roundId,
      startedAt: timer.startedAt,
      durationMs: timer.durationMs,
      endsAt: now + timer.remainingMs,
    },
    now,
  );
  return tournament._id;
}

export async function adjustTimer(
  ctx: MutationCtx,
  access: TournamentAccess,
  args: { deltaMs: number },
) {
  const { tournament } = access;
  const timer = tournament.roundTimer;
  if (!timer) {
    throw userError("No timer to adjust");
  }
  if (
    !Number.isInteger(args.deltaMs) ||
    args.deltaMs === 0 ||
    Math.abs(args.deltaMs) > MAX_TIMER_ADJUST_MS
  ) {
    throw userError("Invalid timer adjustment");
  }
  const durationMs = Math.max(timer.durationMs + args.deltaMs, 0);
  await writeTimer(
    ctx,
    access,
    "adjusted",
    timer.kind === "running"
      ? { ...timer, endsAt: timer.endsAt + args.deltaMs, durationMs }
      : { ...timer, remainingMs: timer.remainingMs + args.deltaMs, durationMs },
    Date.now(),
  );
  return tournament._id;
}

export async function clearTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  // Idempotent: clearing an absent timer is a no-op, not an error, and
  // appends nothing.
  if (tournament.roundTimer) {
    await writeTimer(ctx, access, "cleared", undefined, Date.now());
  }
  return tournament._id;
}

function validDurationMs(value: number) {
  if (!isValidRoundDurationMs(value)) {
    throw userError("Invalid round duration");
  }
  return value;
}

async function requireTimableCurrentRound(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  if (tournament.lifecycle !== "in_progress") {
    throw userError("Tournament is not in progress");
  }
  const phase = await requireCurrentPhase(ctx, tournament._id);
  if (!phase.phaseCurrentRound) {
    throw userError("No round is in progress");
  }
  const round = await requireRound(ctx, phase.phaseCurrentRound);
  if (round.roundStatus !== "in_progress") {
    throw userError("No round is in progress");
  }
  if (!isPairingsVisibleToPlayers(round)) {
    throw userError("Pairings have not been published");
  }
  return round;
}
