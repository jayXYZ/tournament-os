import * as React from 'react'

// A minute is coarse enough that every client asking for the same screen in
// the same minute shares one Convex query-cache entry, and fine enough for
// the states it drives (an event leaving the upcoming list, a sale window
// opening, a refund deadline passing).
export const CLIENT_CLOCK_RESOLUTION_MS = 60_000

export type ClientClockOptions = {
  resolutionMs?: number
  // Which side of the resolution bucket to report. `down` (the default) is
  // the cache-friendly choice for public listings. `up` reports a time at or
  // after the real one, so a server verdict computed from it is never more
  // generous than the one a mutation run right now would reach — the
  // choice for anything that reads as a promise, like a refund outcome.
  round?: 'down' | 'up'
}

export function roundedClock(
  at: number,
  resolutionMs: number,
  round: 'down' | 'up',
) {
  return (
    (round === 'up' ? Math.ceil : Math.floor)(at / resolutionMs) * resolutionMs
  )
}

// The client's clock, rounded to `resolutionMs`, for time-dependent queries.
// Convex does not rerun a query merely because time advances, so a handler
// that read Date.now() would hand back a stale verdict until some unrelated
// write re-executed it; passing `now` as an argument makes the client
// responsible for refreshing it instead.
//
// Ticks are scheduled on the bucket boundary (not `resolutionMs` after
// mount), so the value changes the moment the real clock crosses it, and
// re-checked when the tab regains visibility or focus, since browsers
// throttle timers in background tabs. The value only changes when the
// rounded clock does, so re-renders (and query re-subscriptions) happen at
// most once per bucket.
export function useClientClock({
  resolutionMs = CLIENT_CLOCK_RESOLUTION_MS,
  round = 'down',
}: ClientClockOptions = {}) {
  const [now, setNow] = React.useState(() =>
    roundedClock(Date.now(), resolutionMs, round),
  )

  React.useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const at = Date.now()
      setNow(roundedClock(at, resolutionMs, round))
      // Next boundary, plus a hair so the timer fires on its far side even
      // if the browser rounds the delay.
      const next = Math.floor(at / resolutionMs) * resolutionMs + resolutionMs
      timeout = setTimeout(tick, next - at + 1)
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timeout)
        tick()
      }
    }
    tick()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [resolutionMs, round])

  return now
}
