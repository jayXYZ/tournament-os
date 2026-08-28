import * as React from 'react'

// SSR-safe media query hook. The server (and the hydration render, which must
// produce the same tree) reports `false`, so viewports that match correct in a
// follow-up render right after mount — useSyncExternalStore re-checks the
// client snapshot when it subscribes. Snapshotting the same media query the
// subscription listens to (rather than checking window.innerWidth) keeps the
// value from disagreeing with CSS at fractional viewport widths or zoom
// levels.
export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      const mql = window.matchMedia(query)

      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    [query],
  )

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
