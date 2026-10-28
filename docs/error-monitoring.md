# Error monitoring

Web browser/SSR and native Sentry wiring is merged into `main` and inert
until DSNs are configured. Convex exception reporting is a separate
deployment integration. Code availability does not establish that any of
these environments is sending errors.

As of the 2026-10-28 documentation audit, a run of
`scripts/setup-error-monitoring.sh` for projects/DSNs had been reported, but
no environment-specific event receipt or source-map check was recorded. The
recorded Convex blocker was its Pro integration requirement; the audit did
not inspect the current team plan or dashboard configuration. See
[delivery status](delivery-status.md).

The setup script walks through projects, DSNs, source-map credentials, and
dashboard integrations. Completing that walkthrough is configuration work;
the verification steps below establish whether capture works.

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
  `SENTRY_PROJECT`; a build without credentials is a plain build. With the
  token set, the config refuses to load unless org/project look like Sentry
  URL slugs (or a numeric project ID), and an upload failure fails the build
  instead of being logged and ignored. Pasting the DSN or the token into
  `SENTRY_PROJECT` / `SENTRY_ORG` is the usual mistake.

## Native (`apps/native`) — `@sentry/react-native`

Enabled by `EXPO_PUBLIC_SENTRY_DSN`.

- `src/app/_layout.tsx` — `Sentry.init` before the root layout renders;
  the layout export is wrapped with `Sentry.wrap` when a DSN is present.
- `metro.config.js` — built on `getSentryExpoConfig` (a superset of Expo's
  default config) so bundles carry the debug IDs symbolication needs.
- `app.config.ts` — the `@sentry/react-native` config plugin handles native-build
  source-map/dSYM upload, reading `SENTRY_ORG` / `SENTRY_PROJECT` /
  `SENTRY_AUTH_TOKEN` from the build environment. Verify JS and native-crash
  capture in a development or EAS build. This app requires Clerk's native
  modules as well and cannot run in Expo Go; see the
  [native README](../apps/native/README.md).

## Convex (`packages/backend`) — dashboard integration

Convex reports function exceptions to Sentry through a per-deployment
dashboard integration (Deployment Settings → Integrations → Exception
Reporting): paste a DSN from a Node.js-platform Sentry project. There is no
code side — Convex tags events with function name/type, request ID,
deployment, and the caller's identity automatically. **Requires Convex
Pro**; until the team is on Pro, Convex errors are visible only in the
dashboard logs page.

## Environment variables

| Variable                       | Where                                    | Purpose                                                                         |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `VITE_SENTRY_DSN`              | `apps/web/.env.local`, Vercel            | web reporting (client + SSR)                                                    |
| `EXPO_PUBLIC_SENTRY_DSN`       | `apps/native/.env.local`, EAS            | native reporting                                                                |
| `SENTRY_ORG`, `SENTRY_PROJECT` | both `.env.local`s, Vercel, EAS          | source-map upload target (URL slugs, e.g. `my-org` / `my-org-web`; not the DSN) |
| `SENTRY_AUTH_TOKEN`            | both `.env.local`s (secret), Vercel, EAS | source-map upload auth                                                          |

DSNs are optional: without them, the apps build and run with reporting
disabled. Source-map upload credentials are separate from event capture.

## Deployment verification still to record

- Web browser: trigger a controlled exception on the intended deployment,
  confirm the event arrives in the expected project/environment, and check
  that its stack resolves to the source file and line for the deployed SHA.
- Web SSR: exercise a controlled server failure and confirm a separate
  server event with readable source locations. A browser event does not
  verify server instrumentation.
- Native: use a dev or release build on a named OS/device; verify JS capture
  and native crash reporting separately, including symbolication for that
  build. A Metro export does not run either path.
- Convex: after enabling the integration on the target deployment, trigger
  a controlled function exception and confirm its event and function/request
  metadata in the backend Sentry project.

Use a test environment for deliberate failures and remove temporary probes.
Record the deployment/build, revision, date, outcome, and issue reference in
[delivery status](delivery-status.md). Keep each surface open in roadmap
section 0 until its own check passes.
