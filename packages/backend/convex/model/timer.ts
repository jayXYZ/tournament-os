import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_TIMER_ADJUST_MS,
  isValidRoundDurationMs,
} from "@tournament-os/shared/timer-utils";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { TournamentAccess } from "./tournaments";
import { logAuditEvent, type TournamentAuditEvent } from "./auditLog";
import { requireCurrentPhase } from "./phases";
import { isPairingsVisibleToPlayers, requireRound } from "./tournaments";

// Timer writes and their audit entry share one transaction. Lifecycle-driven
// cleanup is instead represented by the enclosing lifecycle event.
async function writeTimer(
  ctx: MutationCtx,
  access: TournamentAccess,
  patch: Pick<Doc<"tournaments">, "roundTimer" | "updatedAt">,
  action: Extract<
    TournamentAuditEvent,
    { type: "round_timer_changed" }
  >["action"],
) {
  await ctx.db.patch(access.tournament._id, patch);
  await logAuditEvent(ctx, {
    tournamentId: access.tournament._id,
    actor: access.user,
    actorRole: "organizer",
    event: {
      type: "round_timer_changed",
      action,
      previousTimer: access.tournament.roundTimer ?? null,
      timer: patch.roundTimer ?? null,
    },
  });
}

export async function setRoundDuration(
  ctx: MutationCtx,
  access: TournamentAccess,
  args: { durationMs: number },
) {
  const { tournament } = access;
  if (tournament.lifecycle === "cancelled") {
    throw new Error("Tournament has been cancelled");
  }
  const durationMs = validDurationMs(args.durationMs);
  if (durationMs === tournament.roundDurationMs) return tournament._id;
  await ctx.db.patch(tournament._id, {
    roundDurationMs: durationMs,
    updatedAt: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: access.user,
    actorRole: "organizer",
    event: {
      type: "round_duration_changed",
      durationMs,
      previousDurationMs: tournament.roundDurationMs ?? null,
    },
  });
  return tournament._id;
}

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
    {
      roundTimer: {
        kind: "running",
        roundId: round._id,
        startedAt: now,
        durationMs,
        endsAt: now + durationMs,
      },
      updatedAt: now,
    },
    "started",
  );
  return tournament._id;
}

export async function pauseTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  const timer = tournament.roundTimer;
  if (timer?.kind !== "running") {
    throw new Error("Timer is not running");
  }
  const now = Date.now();
  await writeTimer(
    ctx,
    access,
    {
      roundTimer: {
        kind: "paused",
        roundId: timer.roundId,
        startedAt: timer.startedAt,
        durationMs: timer.durationMs,
        // Negative when pausing in overtime; resume picks up mid-overtime.
        remainingMs: timer.endsAt - now,
      },
      updatedAt: now,
    },
    "paused",
  );
  return tournament._id;
}

export async function resumeTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  const timer = tournament.roundTimer;
  if (timer?.kind !== "paused") {
    throw new Error("Timer is not paused");
  }
  const now = Date.now();
  await writeTimer(
    ctx,
    access,
    {
      roundTimer: {
        kind: "running",
        roundId: timer.roundId,
        startedAt: timer.startedAt,
        durationMs: timer.durationMs,
        endsAt: now + timer.remainingMs,
      },
      updatedAt: now,
    },
    "resumed",
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
  await writeTimer(
    ctx,
    access,
    {
      roundTimer:
        timer.kind === "running"
          ? { ...timer, endsAt: timer.endsAt + args.deltaMs, durationMs }
          : {
              ...timer,
              remainingMs: timer.remainingMs + args.deltaMs,
              durationMs,
            },
      updatedAt: Date.now(),
    },
    "adjusted",
  );
  return tournament._id;
}

export async function clearTimer(ctx: MutationCtx, access: TournamentAccess) {
  const { tournament } = access;
  // Idempotent: clearing an absent timer is a no-op, not an error.
  if (tournament.roundTimer) {
    await writeTimer(
      ctx,
      access,
      {
        roundTimer: undefined,
        updatedAt: Date.now(),
      },
      "cleared",
    );
  }
  return tournament._id;
}

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
