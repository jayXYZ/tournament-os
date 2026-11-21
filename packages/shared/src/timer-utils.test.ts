import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_ROUND_DURATION_MS,
  MIN_ROUND_DURATION_MS,
  MAX_MATCH_TIME_EXTENSION_MINUTES,
  durationMsToMinutes,
  extendRoundTimer,
  formatTimeExtension,
  formatTimer,
  isValidMatchTimeExtensionMinutes,
  isValidRoundDurationMs,
  overtimeCreditAt,
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

const FIVE_MIN = 5 * 60_000;

test("extendRoundTimer moves a running match's deadline past the round's", () => {
  const base = runningTimer(NOW + 60_000);
  const extended = extendRoundTimer(base, {
    extensionMs: FIVE_MIN,
    overtimeCreditMs: 0,
  });
  assert.deepEqual(timerSnapshot(extended, NOW), {
    phase: "running",
    remainingMs: 60_000 + FIVE_MIN,
  });
  assert.equal(extended?.durationMs, DEFAULT_ROUND_DURATION_MS + FIVE_MIN);
  // The round's own timer is untouched.
  assert.equal(timerRemainingMs(base, NOW), 60_000);
});

test("extendRoundTimer keeps a paused round paused, with the extension added", () => {
  const extended = extendRoundTimer(pausedTimer(120_000), {
    extensionMs: FIVE_MIN,
    overtimeCreditMs: 0,
  });
  assert.deepEqual(timerSnapshot(extended, NOW + 10 * 60_000), {
    phase: "paused",
    remainingMs: 120_000 + FIVE_MIN,
  });
});

test("extendRoundTimer leaves no timer and no extension alone", () => {
  assert.equal(
    extendRoundTimer(null, { extensionMs: FIVE_MIN, overtimeCreditMs: 0 }),
    null,
  );
  assert.equal(extendRoundTimer(undefined, null), undefined);
  const base = runningTimer(NOW + 60_000);
  assert.equal(extendRoundTimer(base, null), base);
});

test("an extension granted in overtime restarts the match's countdown", () => {
  // Base time ran out two minutes ago; a +5 granted now gives five minutes.
  const base = runningTimer(NOW - 120_000);
  const overtimeCreditMs = overtimeCreditAt(base, NOW);
  assert.equal(overtimeCreditMs, 120_000);
  const extension = { extensionMs: FIVE_MIN, overtimeCreditMs };
  assert.deepEqual(timerSnapshot(extendRoundTimer(base, extension), NOW), {
    phase: "running",
    remainingMs: FIVE_MIN,
  });
  // It runs down and then goes into the match's own overtime.
  assert.equal(
    timerSnapshot(extendRoundTimer(base, extension), NOW + FIVE_MIN + 1_000)
      .phase,
    "overtime",
  );
});

test("an extension granted while paused in overtime resumes as a countdown", () => {
  const base = pausedTimer(-30_000);
  const overtimeCreditMs = overtimeCreditAt(base, NOW);
  assert.equal(overtimeCreditMs, 30_000);
  assert.deepEqual(
    timerSnapshot(
      extendRoundTimer(base, { extensionMs: FIVE_MIN, overtimeCreditMs }),
      NOW,
    ),
    { phase: "paused", remainingMs: FIVE_MIN },
  );
});

test("overtimeCreditAt is zero with no timer or time remaining", () => {
  assert.equal(overtimeCreditAt(null, NOW), 0);
  assert.equal(overtimeCreditAt(runningTimer(NOW + 1), NOW), 0);
  assert.equal(overtimeCreditAt(pausedTimer(0), NOW), 0);
});

test("isValidMatchTimeExtensionMinutes accepts whole minutes in bounds", () => {
  assert.equal(isValidMatchTimeExtensionMinutes(1), true);
  assert.equal(
    isValidMatchTimeExtensionMinutes(MAX_MATCH_TIME_EXTENSION_MINUTES),
    true,
  );
  for (const minutes of [
    0,
    -5,
    2.5,
    Number.NaN,
    MAX_MATCH_TIME_EXTENSION_MINUTES + 1,
  ]) {
    assert.equal(isValidMatchTimeExtensionMinutes(minutes), false);
  }
});

test("formatTimeExtension renders the player-facing marker", () => {
  assert.equal(formatTimeExtension(FIVE_MIN), "+5 min");
});
