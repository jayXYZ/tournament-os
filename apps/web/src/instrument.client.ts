import * as Sentry from '@sentry/tanstackstart-react'

// No-ops when VITE_SENTRY_DSN is unset (local dev without monitoring).
const dsn = (import.meta as any).env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta as any).env.MODE,
    tracesSampleRate: 1.0,
  })
}
