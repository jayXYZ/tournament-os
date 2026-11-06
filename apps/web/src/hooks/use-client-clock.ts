import { useClientClock as useSharedClientClock } from '@paper-pairings/core'
import type { ClientClockOptions, SubscribeToWake } from '@paper-pairings/core'

// Browsers throttle timers in background tabs, so the clock re-reads the
// time when the tab becomes visible or the window regains focus.
const subscribeToBrowserWake: SubscribeToWake = (refresh) => {
  const onWake = () => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  }
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)
  return () => {
    document.removeEventListener('visibilitychange', onWake)
    window.removeEventListener('focus', onWake)
  }
}

// Web's binding of the shared client clock (see @paper-pairings/core
// client-clock.ts) to the browser's wake signals.
export function useClientClock(options: ClientClockOptions = {}) {
  return useSharedClientClock({
    ...options,
    subscribeToWake: subscribeToBrowserWake,
  })
}
