export const DEFAULT_ROUND_DURATION_MS = 50 * 60_000;
export const MIN_ROUND_DURATION_MS = 60_000;
export const MAX_ROUND_DURATION_MS = 240 * 60_000;
export const MAX_TIMER_ADJUST_MS = 60 * 60_000;

// Structural mirror of the backend's tournamentRoundTimerValidator. This
// package cannot depend on the backend, so roundId is a plain string here;
// tournament-core re-exposes the Doc-derived type for strict consumers.
export type RoundTimerState =
  | {
      kind: "running";
      roundId: string;
      /** Epoch ms when remaining time hits zero; clients tick against this. */
      endsAt: number;
      durationMs: number;
      startedAt: number;
    }
  | {
      kind: "paused";
      roundId: string;
      /** Frozen remainder; negative when paused while already in overtime. */
      remainingMs: number;
      durationMs: number;
      startedAt: number;
    };

export type TimerPhase = "idle" | "running" | "paused" | "overtime";

export type TimerSnapshot = {
  phase: TimerPhase;
  remainingMs: number;
};

export function isValidRoundDurationMs(value: number) {
  return (
    Number.isInteger(value) &&
    value >= MIN_ROUND_DURATION_MS &&
    value <= MAX_ROUND_DURATION_MS
  );
}

export function timerRemainingMs(timer: RoundTimerState, now: number) {
  return timer.kind === "running" ? timer.endsAt - now : timer.remainingMs;
}

// A paused timer with negative remaining reports "paused" (not "overtime");
// displays style the negative remainder as overtime themselves.
export function timerSnapshot(
  timer: RoundTimerState | null | undefined,
  now: number,
): TimerSnapshot {
  if (!timer) {
    return { phase: "idle", remainingMs: 0 };
  }

  const remainingMs = timerRemainingMs(timer, now);
  if (timer.kind === "paused") {
    return { phase: "paused", remainingMs };
  }

  return { phase: remainingMs < 0 ? "overtime" : "running", remainingMs };
}

// Countdowns round up (a round with 1ms left still reads 0:01 and shows 0:00
// exactly at zero); overtime counts elapsed whole seconds up, prefixed "+".
export function formatTimer(ms: number) {
  const overtime = ms < 0;
  const totalSeconds = overtime ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const core =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;

  return overtime ? `+${core}` : core;
}

export function durationMsToMinutes(ms: number) {
  return Math.round(ms / 60_000);
}

export function minutesToDurationMs(minutes: number) {
  return Math.round(minutes) * 60_000;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
