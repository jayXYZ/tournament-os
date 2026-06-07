# Route Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` the player-facing upcoming tournaments table and move organizer controls to `/admin`.

**Architecture:** Add a bounded public Convex query for upcoming public tournaments, backed by a status/start-date index. Split the current single page into a player home route and an admin route, with focused client components for each surface and simple `next/link` navigation between them.

**Tech Stack:** Next.js 16 App Router, React 19, Convex, WorkOS AuthKit, Tailwind CSS, Vitest/convex-test.

---

### Task 1: Public Upcoming Tournament Query

**Files:**
- Modify: `convex/tournaments.convex.spec.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/tournaments.ts`

- [ ] **Step 1: Write the failing test**

Add a Vitest case that seeds past, private, cancelled, in-progress, and public future tournaments, then asserts `api.tournaments.listUpcomingPublic` returns only future public tournaments in ascending start date order.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`
Expected: FAIL because `api.tournaments.listUpcomingPublic` is not defined.

- [ ] **Step 3: Add schema index and query**

Add `.index("by_status_and_startDate", ["status", "startDate"])` to `tournaments`. Add `listUpcomingPublic` with `args: {}` that queries public tournaments with that index, orders ascending, and takes a bounded list.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`
Expected: PASS for the new query test and existing tournament tests.

### Task 2: Route Split And Player Home

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/components/player-home.tsx`
- Create: `app/components/organizer-workspace.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Move organizer UI**

Move the existing authenticated organizer workspace and supporting metric helpers into `app/components/organizer-workspace.tsx`. Create `app/admin/page.tsx` that renders auth loading, signed-out sign-in prompt, and the organizer workspace for authenticated users.

- [ ] **Step 2: Build player home**

Create `app/components/player-home.tsx` as a client component that calls `api.tournaments.listUpcomingPublic`, displays loading/empty/table states, keeps auth controls available, and includes an `Admin` link to `/admin`.

- [ ] **Step 3: Simplify root page**

Replace `app/page.tsx` with a small server component that renders `PlayerHome`.

- [ ] **Step 4: Verify route compilation**

Run: `pnpm run lint`
Expected: exit 0.

Run: `pnpm run build`
Expected: exit 0.

### Task 3: Final Verification

**Files:**
- Review changed files and generated Convex types if they update during build/test.

- [ ] **Step 1: Run focused backend tests**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`
Expected: exit 0.

- [ ] **Step 2: Run full lint and build**

Run: `pnpm run lint`
Expected: exit 0.

Run: `pnpm run build`
Expected: exit 0.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- app convex docs/superpowers/plans/2026-06-07-route-reorganization.md`
Expected: diff only contains the planned route, UI, test, and query changes.
