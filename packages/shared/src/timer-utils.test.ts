import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_ROUND_DURATION_MS,
  MIN_ROUND_DURATION_MS,
  durationMsToMinutes,
  formatTimer,
  isValidRoundDurationMs,
  minutesToDurationMs,
  timerRemainingMs,
  timerSnapshot,
  type RoundTimerState,
} from "./timer-utils.ts";

const NOW = 1_750_000_000_000;

function runningTimer(endsAt: number): RoundTimerState {
  return {
    kind: "running",
    roundId: "round1",
    endsAt,
    durationMs: DEFAULT_ROUND_DURATION_MS,
    startedAt: NOW - 1_000,
  };
}

function pausedTimer(remainingMs: number): RoundTimerState {
  return {
    kind: "paused",
    roundId: "round1",
    remainingMs,
    durationMs: DEFAULT_ROUND_DURATION_MS,
    startedAt: NOW - 1_000,
  };
}

test("formatTimer renders countdown, hour rollover, and overtime", () => {
  assert.equal(formatTimer(0), "0:00");
  assert.equal(formatTimer(1), "0:01");
  assert.equal(formatTimer(59_999), "1:00");
  assert.equal(formatTimer(DEFAULT_ROUND_DURATION_MS), "50:00");
  assert.equal(formatTimer(3_600_000), "1:00:00");
  assert.equal(formatTimer(3_600_000 + 61_000), "1:01:01");
  assert.equal(formatTimer(-1), "+0:00");
  assert.equal(formatTimer(-154_000), "+2:34");
  assert.equal(formatTimer(-3_600_000), "+1:00:00");
});

test("timerRemainingMs reads the anchor for both kinds", () => {
  assert.equal(timerRemainingMs(runningTimer(NOW + 5_000), NOW), 5_000);
  assert.equal(timerRemainingMs(runningTimer(NOW - 5_000), NOW), -5_000);
  assert.equal(timerRemainingMs(pausedTimer(12_345), NOW), 12_345);
});

test("timerSnapshot derives idle, running, overtime, and paused phases", () => {
  assert.deepEqual(timerSnapshot(null, NOW), { phase: "idle", remainingMs: 0 });
  assert.deepEqual(timerSnapshot(undefined, NOW), {
    phase: "idle",
    remainingMs: 0,
  });
  assert.deepEqual(timerSnapshot(runningTimer(NOW + 5_000), NOW), {
    phase: "running",
    remainingMs: 5_000,
  });
  assert.deepEqual(timerSnapshot(runningTimer(NOW), NOW), {
    phase: "running",
    remainingMs: 0,
  });
  assert.deepEqual(timerSnapshot(runningTimer(NOW - 1), NOW), {
    phase: "overtime",
    remainingMs: -1,
  });
  // Paused in overtime stays "paused"; the negative remainder carries the info.
  assert.deepEqual(timerSnapshot(pausedTimer(-2_000), NOW), {
    phase: "paused",
    remainingMs: -2_000,
  });
});

test("isValidRoundDurationMs enforces integer bounds", () => {
  assert.equal(isValidRoundDurationMs(MIN_ROUND_DURATION_MS), true);
  assert.equal(isValidRoundDurationMs(MAX_ROUND_DURATION_MS), true);
  assert.equal(isValidRoundDurationMs(DEFAULT_ROUND_DURATION_MS), true);
  assert.equal(isValidRoundDurationMs(MIN_ROUND_DURATION_MS - 1), false);
  assert.equal(isValidRoundDurationMs(MAX_ROUND_DURATION_MS + 1), false);
  assert.equal(isValidRoundDurationMs(MIN_ROUND_DURATION_MS + 0.5), false);
  assert.equal(isValidRoundDurationMs(Number.NaN), false);
});

test("duration/minute conversions round-trip", () => {
  assert.equal(durationMsToMinutes(DEFAULT_ROUND_DURATION_MS), 50);
  assert.equal(minutesToDurationMs(50), DEFAULT_ROUND_DURATION_MS);
  assert.equal(durationMsToMinutes(minutesToDurationMs(37)), 37);
});
