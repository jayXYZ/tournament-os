# Browser E2E tests

Playwright tests that drive the real web app in Chromium against the cloud
dev Convex deployment.

## Running

```sh
pnpm test:e2e          # from the repo root or apps/web
```

The config starts `vite dev` on port 3000 if it isn't already running. If
backend code changed since the Convex dev process last pushed, run
`pnpm dev:backend` (or `convex dev --once` in `packages/backend`) first so the
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
  private events, plus the invite-link settings card (regenerate/disable).

## Test data

Tests create tournaments marked as test events under the "E2E Test
Organization" workspace and complete them, so they accumulate as finished
test tournaments in the dev deployment. Pre-production, that's acceptable;
`pnpm db:wipe` resets the deployment whenever wanted.

## Isolated CI smoke suite

`pnpm test:smoke` launches a separate Vite entry point on port 3100 and runs
Chromium against the real registration, badge, and organizer timeline
components. It requires no secrets or cloud data. The tests exercise auth
readiness, registration/cancellation, and publish → pair → publish-pairings
controls, asserting the mutation names and arguments they send.

Only the smoke Vite config aliases auth/Convex hooks to deterministic
in-memory adapters. These adapters are outside the application entry point
and never enter the production build. This checks browser rendering and UI
wiring; it does not verify Clerk token issuance, Convex transport, or Stripe.
The cloud suite above and backend integration tests cover those separate
boundaries. The two Playwright configs exclude each other's tests.

CI runs `pnpm build:web` independently of the smoke harness, then this suite,
and uploads traces on failure. To install Chromium locally, run
`pnpm --filter @tournament-os/web exec playwright install chromium`.
