import * as React from 'react'

// Tailwind's `lg` breakpoint (64rem = 1024px at the default font size), as a
// media query so it resolves exactly like the `lg:` classes it partners with.
// This is the only place the value exists in JS: components that mount
// different trees on either side of `lg` read this hook, and their CSS uses
// plain `lg:` variants.
const DESKTOP_QUERY = '(min-width: 64rem)'

// True from Tailwind's `lg` breakpoint up. SSR-safe: the server (and the
// hydration render, which must produce the same tree) reports `false`, so
// server HTML is always the phone shape and desktop viewports widen in a
// follow-up render right after mount — useSyncExternalStore re-checks the
// client snapshot when it subscribes. That one-frame phone-first paint on
// desktop is the price of never mismatching hydration.
export function useIsDesktop() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)

  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

function getServerSnapshot() {
  return false
}
