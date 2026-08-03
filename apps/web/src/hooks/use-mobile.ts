import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(callback: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)

  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot() {
  // Snapshot the same media query the subscription listens to (the
  // use-desktop.ts idiom): a `window.innerWidth < 768` check can disagree
  // with the query at fractional viewport widths or zoom levels, leaving a
  // stale value that only corrects on the next boundary crossing.
  return window.matchMedia(MOBILE_QUERY).matches
}

function getServerSnapshot() {
  return false
}
