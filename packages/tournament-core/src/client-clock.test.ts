// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { roundedClock, useClientClock } from "./client-clock.ts";
import type { ClientClockOptions, SubscribeToWake } from "./client-clock.ts";

const MINUTE = 60_000;
// A wall-clock instant 20s past a minute boundary.
const BOUNDARY = Math.floor(1_700_000_000_000 / MINUTE) * MINUTE;
const T0 = BOUNDARY + 20_000;

// A wake source the test fires by hand, standing in for the web's
// visibilitychange and native's AppState.
let wakeListeners: Set<() => void>;
const subscribeToWake: SubscribeToWake = (refresh) => {
  wakeListeners.add(refresh);
  return () => wakeListeners.delete(refresh);
};

let renders = 0;
let latest: number;
function Probe(options: ClientClockOptions) {
  renders += 1;
  latest = useClientClock({ ...options, subscribeToWake });
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  renders = 0;
  wakeListeners = new Set();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(options: ClientClockOptions = {}) {
  act(() => {
    root.render(createElement(Probe, options));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

test("roundedClock rounds to the requested side of the bucket", () => {
  expect(roundedClock(T0, MINUTE, "down")).toBe(BOUNDARY);
  expect(roundedClock(T0, MINUTE, "up")).toBe(BOUNDARY + MINUTE);
  expect(roundedClock(BOUNDARY, MINUTE, "up")).toBe(BOUNDARY);
});

test("ticks on the minute boundary, not a minute after mount", () => {
  mount();
  expect(latest).toBe(BOUNDARY);
  const rendersAfterMount = renders;

  // 39s later we are 1s short of the boundary: no change, no re-render.
  advance(39_000);
  expect(latest).toBe(BOUNDARY);
  expect(renders).toBe(rendersAfterMount);

  // Crossing the boundary flips the value once.
  advance(2_000);
  expect(latest).toBe(BOUNDARY + MINUTE);
  expect(renders).toBe(rendersAfterMount + 1);

  // And the next tick is again aligned to the boundary.
  advance(MINUTE);
  expect(latest).toBe(BOUNDARY + 2 * MINUTE);
});

test("rounding up reports the far side of the bucket and advances at the boundary", () => {
  mount({ round: "up" });
  expect(latest).toBe(BOUNDARY + MINUTE);
  advance(40_000);
  expect(latest).toBe(BOUNDARY + MINUTE);
  advance(1_000);
  expect(latest).toBe(BOUNDARY + 2 * MINUTE);
});

test("re-reads the clock when the wake source fires after a stalled timer", () => {
  mount();
  expect(latest).toBe(BOUNDARY);
  // Jump the system clock without running timers, as a suspended app or a
  // throttled background tab would leave it.
  vi.setSystemTime(T0 + 5 * MINUTE);
  expect(latest).toBe(BOUNDARY);
  act(() => {
    for (const refresh of wakeListeners) refresh();
  });
  expect(latest).toBe(BOUNDARY + 5 * MINUTE);
});

test("unsubscribes from the wake source on unmount", () => {
  mount();
  expect(wakeListeners.size).toBe(1);
  act(() => {
    root.unmount();
  });
  expect(wakeListeners.size).toBe(0);
  // afterEach unmounts again; give it a fresh root to unmount.
  root = createRoot(container);
});
