# Tournament OS

Monorepo for Tournament OS — organizer workspaces and event operations for Magic tournaments.

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

- `pnpm check` — format check + typecheck + lint + test, the full gate CI mirrors
- `pnpm test` — run every workspace's unit/integration tests
- `pnpm test:e2e` — Playwright browser tests (see `apps/web/e2e/README.md`)
- `pnpm build` — build the web app and export the native bundles
- `pnpm start` — serve the built web app
- `pnpm lint` — eslint over web, native, and backend
- `pnpm typecheck` — run package typecheck scripts (backend, tournament-core, shared)
- `pnpm format` / `pnpm format:check` — prettier over the whole repo
- `pnpm db:wipe` — reset the dev Convex deployment (pre-production; safe)

## Roadmap

See [TODO.md](./TODO.md) for the audited, dependency-ordered roadmap.
