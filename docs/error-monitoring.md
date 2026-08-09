# Error monitoring

Sentry monitors all three surfaces. The code-side wiring is committed and
inert until DSNs are configured; run `scripts/setup-error-monitoring.sh` for
a guided walkthrough of the account-side setup (Sentry projects, DSNs,
source-map credentials, dashboard integrations).

## Web (`apps/web`) — `@sentry/tanstackstart-react`

Enabled by `VITE_SENTRY_DSN` (build-time, same handling as
`VITE_CONVEX_URL`). Without it every piece below is a no-op.

- `src/instrument.client.ts` / `src/instrument.server.ts` — `Sentry.init`
  for the browser and the SSR server. Loaded first by the custom entries
  `src/client.tsx` and `src/server.ts`; the server entry also wraps the
  request handler with `wrapFetchWithSentry`.
- `src/start.ts` — `sentryGlobalRequestMiddleware` (before Clerk, so auth
  failures are captured too) and `sentryGlobalFunctionMiddleware` for server
  functions.
- `src/router.tsx` — the default error component reports render/loader
  errors via `captureException`; browser-side navigation tracing comes from
  `tanstackRouterBrowserTracingIntegration`.
- `vite.config.ts` — the Sentry build plugin (source-map upload) activates
  only when `SENTRY_AUTH_TOKEN` is set, alongside `SENTRY_ORG` and
  `SENTRY_PROJECT`; a build without credentials is a plain build.

## Native (`apps/native`) — `@sentry/react-native`

Enabled by `EXPO_PUBLIC_SENTRY_DSN`.

- `src/app/_layout.tsx` — `Sentry.init` before the root layout renders;
  the layout export is wrapped with `Sentry.wrap` when a DSN is present.
- `metro.config.js` — built on `getSentryExpoConfig` (a superset of Expo's
  default config) so bundles carry the debug IDs symbolication needs.
- `app.json` — the `@sentry/react-native` config plugin handles native-build
  source-map/dSYM upload, reading `SENTRY_ORG` / `SENTRY_PROJECT` /
  `SENTRY_AUTH_TOKEN` from the build environment. Native-crash capture
  requires a dev build (`expo run:ios|android`) or EAS build — Expo Go
  cannot load the native module, though JS errors still report there.

## Convex (`packages/backend`) — dashboard integration

Convex reports function exceptions to Sentry through a per-deployment
dashboard integration (Deployment Settings → Integrations → Exception
Reporting): paste a DSN from a Node.js-platform Sentry project. There is no
code side — Convex tags events with function name/type, request ID,
deployment, and the caller's identity automatically. **Requires Convex
Pro**; until the team is on Pro, Convex errors are visible only in the
dashboard logs page.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | `apps/web/.env.local`, Vercel | web reporting (client + SSR) |
| `EXPO_PUBLIC_SENTRY_DSN` | `apps/native/.env.local`, EAS | native reporting |
| `SENTRY_ORG`, `SENTRY_PROJECT` | both `.env.local`s, Vercel, EAS | source-map upload target |
| `SENTRY_AUTH_TOKEN` | both `.env.local`s (secret), Vercel, EAS | source-map upload auth |

All are optional: absent, the apps build and run with monitoring disabled.
