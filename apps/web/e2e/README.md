# Browser E2E tests

Playwright tests that drive the real web app in Chromium against the cloud
dev Convex deployment.

## Running

```sh
pnpm test:e2e          # from the repo root or apps/web
```

The config starts `vite dev` on port 3000 if it isn't already running. If
backend code changed since the Convex dev process last pushed, run
`pnpm dev:backend` (or `pnpm --filter @paper-pairings/backend exec convex dev --once`
from the repo root) first so the
deployment matches the working tree.

Requirements:

- `apps/web/.env.local` with `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`,
  and `CLERK_SECRET_KEY`
- Chromium installed for Playwright (`pnpm exec playwright install chromium`)

## How auth works

Sign-in is Google OAuth only, which can't be automated headlessly. The
`auth.setup.ts` project instead uses the Clerk Backend API to find or create
the `e2e-organizer@example.com` user, mints a sign-in ticket, activates the
session through `window.Clerk`, and saves the browser storage state to
`e2e/.auth/organizer.json` (gitignored) for the test projects.

## Coverage

- `organizer-happy-path.spec.ts` — create → publish → register → pair →
  report → complete, with real result entry each round.
- `organizer-corrections.spec.ts` — active-round result correction (and its
  audit-trail entry), a pairing rewind that reopens the previous round, and
  an organizer drop that produces a bye round and a "Dropped" standings row.
- `organizer-mid-round-drop.spec.ts` — a drop during an unreported match
  concedes it to the opponent immediately (required-wins–0, typed
  `match_conceded` audit event) and the round completes off the concession.
- `invite-links.spec.ts` — the `/join/<code>` route and `?invite` param for
  private events, including creation from the settings card, signed-out
  viewing, and player registration. Rotation/disabling and the full grant
  boundary are covered by `inviteLinks.convex.spec.ts`, not this browser spec.

This suite is separate from `pnpm check` and the current CI jobs. A passing
run exercises the configured development environment, not automatically the
release deployment. Approval/payment state coverage and QR browser delivery
remain open in [the roadmap](../../../TODO.md). Record the tested backend
revision with any deployment verification result.

## Test data

Tests create tournaments marked as test events under the "E2E Test
Organization" workspace and complete them, so they accumulate as finished
test tournaments in the dev deployment. Pre-production, that's acceptable;
`pnpm db:wipe` resets the deployment whenever wanted.
