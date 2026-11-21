import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_MATCH_TIME_EXTENSION_MINUTES,
  MAX_TIMER_ADJUST_MS,
  MIN_MATCH_TIME_EXTENSION_MINUTES,
  isValidMatchTimeExtensionMinutes,
  isValidRoundDurationMs,
  minutesToDurationMs,
  overtimeCreditAt,
} from "@paper-pairings/shared/timer-utils";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  auditMatchPlayerRef,
  logAuditEvent,
  type TournamentAuditEvent,
} from "./auditLog";
import { userError } from "./errors";
import { requireCurrentPhase } from "./phases";
import {
  type TournamentAccess,
  isPairingsVisibleToPlayers,
  matchPlayers,
  requireRound,
  roundMatches,
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
  await resetOvertimeCredits(ctx, round, now);
  return tournament._id;
}

// An overtime credit measures overtime on the timer it was granted against.
// A (re)started timer has run none, so a credit kept across the restart would
// hand the match that stale overtime as extra time on top of its extension.
async function resetOvertimeCredits(
  ctx: MutationCtx,
  round: Doc<"tournamentRounds">,
  now: number,
) {
  for (const match of await roundMatches(ctx, round._id)) {
    if (match.timeExtension && match.timeExtension.overtimeCreditMs !== 0) {
      await ctx.db.patch(match._id, {
        timeExtension: { ...match.timeExtension, overtimeCreditMs: 0 },
        updatedAt: now,
      });
    }
  }
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

export const MAX_TIME_EXTENSION_REASON_LENGTH = 200;

// Grants or changes one match's Match Time Extension (see CONTEXT.md). Only
// a match of the live, published round still awaiting its result can be
// extended: the extension rides the round timer, which exists for that round
// alone, and a finished match has no time left to extend. Re-saving the same
// minutes and reason is a no-op that writes and logs nothing.
export async function setMatchTimeExtension(
  ctx: MutationCtx,
  access: TournamentAccess,
  match: Doc<"tournamentMatches">,
  args: { minutes: number; reason?: string },
) {
  if (!isValidMatchTimeExtensionMinutes(args.minutes)) {
    throw userError(
      `Time extensions must be whole minutes from ${MIN_MATCH_TIME_EXTENSION_MINUTES} to ${MAX_MATCH_TIME_EXTENSION_MINUTES}`,
    );
  }
  const reason = cleanExtensionReason(args.reason);
  const { round, players } = await requireExtendableMatch(
    ctx,
    access.tournament,
    match,
  );
  if (match.matchStatus === "completed" || match.matchStatus === "cancelled") {
    throw userError("This match is already finished");
  }

  const extensionMs = minutesToDurationMs(args.minutes);
  const previous = match.timeExtension;
  if (previous?.extensionMs === extensionMs && previous.reason === reason) {
    return match._id;
  }
  const now = Date.now();
  await ctx.db.patch(match._id, {
    timeExtension: {
      extensionMs,
      // Anchored at the first grant only: an edit changes the amount, not
      // where the match's extra time is counted from.
      overtimeCreditMs:
        previous?.overtimeCreditMs ??
        overtimeCreditAt(access.tournament.roundTimer, now),
      reason,
      setByUserId: access.user._id,
      setAt: now,
    },
    updatedAt: now,
  });
  await logExtensionChange(ctx, access, round, match, players, {
    previousExtensionMs: previous?.extensionMs ?? null,
    extensionMs,
    reason: reason ?? null,
  });
  return match._id;
}

// Removes a match's extension. Allowed after the match's result is in, so a
// mistaken grant can still be taken back while the round is live; removing
// an absent extension is a no-op and logs nothing.
export async function clearMatchTimeExtension(
  ctx: MutationCtx,
  access: TournamentAccess,
  match: Doc<"tournamentMatches">,
) {
  const { round, players } = await requireExtendableMatch(
    ctx,
    access.tournament,
    match,
  );
  const previous = match.timeExtension;
  if (!previous) {
    return match._id;
  }
  await ctx.db.patch(match._id, {
    timeExtension: undefined,
    updatedAt: Date.now(),
  });
  await logExtensionChange(ctx, access, round, match, players, {
    previousExtensionMs: previous.extensionMs,
    extensionMs: null,
    reason: null,
  });
  return match._id;
}

async function requireExtendableMatch(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  match: Doc<"tournamentMatches">,
) {
  if (match.tournamentId !== tournament._id) {
    throw new Error("Match does not belong to this tournament");
  }
  const round = await requireTimableCurrentRound(ctx, tournament);
  if (match.tournamentRoundId !== round._id) {
    throw userError("Only matches in the current round can be extended");
  }
  const players = await matchPlayers(ctx, match._id);
  if (players.length < 2 || players.some((player) => player.isBye)) {
    throw userError("A bye has no match time to extend");
  }
  return { round, players };
}

async function logExtensionChange(
  ctx: MutationCtx,
  { tournament, user }: TournamentAccess,
  round: Doc<"tournamentRounds">,
  match: Doc<"tournamentMatches">,
  players: Doc<"tournamentMatchPlayers">[],
  change: {
    previousExtensionMs: number | null;
    extensionMs: number | null;
    reason: string | null;
  },
) {
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "match_time_extension_changed",
      roundId: round._id,
      roundNumber: round.roundNumber,
      tableNumber: match.tableNumber ?? null,
      players: players.map(auditMatchPlayerRef),
      ...change,
    },
  });
}

// Empty and whitespace-only reasons are dropped rather than stored.
function cleanExtensionReason(reason: string | undefined) {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_TIME_EXTENSION_REASON_LENGTH) {
    throw userError(
      `Extension reason must be at most ${MAX_TIME_EXTENSION_REASON_LENGTH} characters`,
    );
  }
  return trimmed;
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
