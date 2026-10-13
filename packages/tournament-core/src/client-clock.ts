import { useEffect, useState } from "react";

// A minute is coarse enough that every client asking for the same screen in
// the same minute shares one Convex query-cache entry, and fine enough for
// the states it drives (an event leaving the upcoming list, a sale window
// opening, a refund deadline passing).
export const CLIENT_CLOCK_RESOLUTION_MS = 60_000;

export type ClientClockOptions = {
  resolutionMs?: number;
  // Which side of the resolution bucket to report. `down` (the default) is
  // the cache-friendly choice for public listings. `up` reports a time at or
  // after the real one, so a server verdict computed from it is never more
  // generous than the one a mutation run right now would reach — the
  // choice for anything that reads as a promise, like a refund outcome.
  round?: "down" | "up";
};

// The platform's "the app is in front again" signal: calls `refresh` each
// time it fires and returns the unsubscribe. Timers stall while a browser
// tab is in the background or a native app is suspended, so the clock
// re-reads the real time on wake instead of waiting out a late timer. Pass a
// module-level function: a new one each render re-subscribes every render.
export type SubscribeToWake = (refresh: () => void) => () => void;

export function roundedClock(
  at: number,
  resolutionMs: number,
  round: "down" | "up",
) {
  return (
    (round === "up" ? Math.ceil : Math.floor)(at / resolutionMs) * resolutionMs
  );
}

// The client's clock, rounded to `resolutionMs`, for time-dependent queries.
// Convex does not rerun a query merely because time advances, so a handler
// that read Date.now() would hand back a stale verdict until some unrelated
// write re-executed it; passing `now` as an argument makes the client
// responsible for refreshing it instead.
//
// Ticks are scheduled on the bucket boundary (not `resolutionMs` after
// mount), so the value changes the moment the real clock crosses it, and
// re-checked whenever `subscribeToWake` fires. The value only changes when
// the rounded clock does, so re-renders (and query re-subscriptions) happen
// at most once per bucket. Each app binds its own wake source in a thin
// wrapper (the web's visibility and focus, native's AppState).
export function useClientClock({
  resolutionMs = CLIENT_CLOCK_RESOLUTION_MS,
  round = "down",
  subscribeToWake,
}: ClientClockOptions & { subscribeToWake: SubscribeToWake }) {
  const [now, setNow] = useState(() =>
    roundedClock(Date.now(), resolutionMs, round),
  );

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = Date.now();
      setNow(roundedClock(at, resolutionMs, round));
      // Next boundary, plus a hair so the timer fires on its far side even
      // if the platform rounds the delay.
      const next = Math.floor(at / resolutionMs) * resolutionMs + resolutionMs;
      timeout = setTimeout(tick, next - at + 1);
    };
    tick();
    const unsubscribe = subscribeToWake(() => {
      clearTimeout(timeout);
      tick();
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [resolutionMs, round, subscribeToWake]);

  return now;
}
