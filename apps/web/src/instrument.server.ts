import * as Sentry from '@sentry/tanstackstart-react'

// No-ops when VITE_SENTRY_DSN is unset (local dev without monitoring).
// VITE_* vars are inlined into the server bundle at build time, so the DSN
// must be present in the build environment (same as VITE_CONVEX_URL).
const dsn = (import.meta as any).env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta as any).env.MODE,
    tracesSampleRate: 1.0,
  })
}
