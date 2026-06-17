# Tournament OS

Monorepo for Tournament OS — organizer workspaces and event operations for Magic tournaments.

## Workspaces

- `apps/web` — TanStack Start web app (Clerk auth, Convex data). The primary app.
- `packages/backend` — Convex backend (schema, functions, generated API) shared by web and mobile.
- `packages/tournament-core` — framework-agnostic tournament/organizer domain logic shared across apps.

## Getting started

Install dependencies from the repo root:

```bash
pnpm install
```

Run the web app and the Convex backend together:

```bash
pnpm dev
```

Or individually:

```bash
pnpm dev:frontend   # apps/web (Vite, port 3000)
pnpm dev:backend    # packages/backend (convex dev)
```

## Scripts

- `pnpm build` — build the web app
- `pnpm start` — serve the built web app
- `pnpm lint` — lint the web app
