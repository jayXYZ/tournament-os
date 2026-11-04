# Paper Pairings

Monorepo for Paper Pairings — organizer workspaces and event operations for Magic tournaments.

## Workspaces

- `apps/web` — TanStack Start web app (Clerk auth, Convex data). The primary app.
- `apps/native` — Expo (React Native) mobile app for players. Requires a dev build; see its README.
- `packages/backend` — Convex backend (schema, functions, generated API) shared by web and mobile.
- `packages/tournament-core` — framework-agnostic tournament/organizer domain logic shared across apps.
- `packages/shared` — pure utilities shared by the backend and clients (match structure, fees, formatting).

## Getting started

Install dependencies from the repo root:

```bash
pnpm install
```

Copy each app's `.env.example` to `.env.local` and fill it in — see
[docs/environment.md](./docs/environment.md) for the full environment
contract, including the variables set on the Convex deployment itself.

Run the web app and the Convex backend together:

```bash
pnpm dev
```

Or individually:

```bash
pnpm dev:frontend   # apps/web (Vite, port 3000)
pnpm dev:backend    # packages/backend (convex dev)
pnpm dev:native     # apps/native (Metro dev server; needs a dev build first)
```

## Scripts

- `pnpm check` — dependency check + format check + typecheck + lint + test
- `pnpm test` — run every workspace's unit/integration tests
- `pnpm test:e2e` — Playwright browser tests (see `apps/web/e2e/README.md`)
- `pnpm build` — build the web app and export the native bundles
- `pnpm start` — serve the built web app (`apps/web/dist` via srvx on :3000)
- `pnpm lint` — eslint over web, native, and backend
- `pnpm typecheck` — run workspace typecheck scripts; web/native TypeScript
  checks also run through their lint scripts
- `pnpm format` / `pnpm format:check` — prettier over the whole repo
- `pnpm db:wipe` — reset the dev Convex deployment (pre-production; safe)

## Roadmap

See [TODO.md](./TODO.md) for priorities and open work, and
[delivery status](./docs/delivery-status.md) for the distinction between
branch implementation, merge to main, and deployment verification.

CI adds a production web build and an iOS/Android bundle export to the checks
in `pnpm check`. Browser E2E runs separately against the configured development
backend. Neither builds nor unit tests establish deployment readiness.

The main documentation entry points are the [environment contract](./docs/environment.md),
[payments](./docs/payments.md), [refund recovery](./docs/refund-recovery.md),
[monitoring](./docs/error-monitoring.md), and [web design conventions](./docs/design/README.md).
The competitive vocabulary lives in [CONTEXT.md](./CONTEXT.md).
