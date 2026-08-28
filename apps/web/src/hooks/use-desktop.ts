import { useMediaQuery } from './use-media-query'

// Tailwind's `lg` breakpoint (64rem = 1024px at the default font size), as a
// media query so it resolves exactly like the `lg:` classes it partners with.
// This is the only place the value exists in JS: components that mount
// different trees on either side of `lg` read this hook, and their CSS uses
// plain `lg:` variants.
const DESKTOP_QUERY = '(min-width: 64rem)'

// True from Tailwind's `lg` breakpoint up. SSR-safe: server HTML is always
// the phone shape and desktop viewports widen right after mount (see
// use-media-query.ts) — the one-frame phone-first paint on desktop is the
// price of never mismatching hydration.
export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY)
}
