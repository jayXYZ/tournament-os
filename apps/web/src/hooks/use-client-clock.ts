import * as React from 'react'

// A minute is coarse enough that every client asking for the same screen in
// the same minute shares one Convex query-cache entry, and fine enough for
// the states it drives (an event leaving the upcoming list, a sale window
// opening, a refund deadline passing).
export const CLIENT_CLOCK_RESOLUTION_MS = 60_000

function roundedNow(resolutionMs: number) {
  return Math.floor(Date.now() / resolutionMs) * resolutionMs
}

// The client's clock, rounded down to `resolutionMs`, for time-dependent
// queries. Convex does not rerun a query merely because time advances, so a
// handler that read Date.now() would hand back a stale verdict until some
// unrelated write re-executed it; passing `now` as an argument makes the
// client responsible for refreshing it instead. The value only changes when
// the rounded clock does, so re-renders (and query re-subscriptions) happen
// once per resolution tick, not once per interval firing.
export function useClientClock(resolutionMs = CLIENT_CLOCK_RESOLUTION_MS) {
  const [now, setNow] = React.useState(() => roundedNow(resolutionMs))

  React.useEffect(() => {
    const tick = () => setNow(roundedNow(resolutionMs))
    tick()
    const interval = setInterval(tick, resolutionMs)
    return () => clearInterval(interval)
  }, [resolutionMs])

  return now
}
