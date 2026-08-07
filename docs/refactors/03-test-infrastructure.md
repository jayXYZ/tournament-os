# Refactor 03 — A test surface outside the backend

## Context for the agent

You are working in `tournament-os`, a pnpm monorepo: `packages/backend`
(Convex), `packages/shared` (pure utilities), `packages/tournament-core`
(shared React hooks), `apps/web` (TanStack Start + Vite), `apps/native`
(Expo). The project is **pre-production**.

This refactor is mostly configuration plus a few `export` keywords. It is a
prerequisite for safely verifying the other refactors in `docs/refactors/`.

## Verified current state (checked 2026-08-07)

- The **only** runnable test suite in the repo is `packages/backend`
  (`"test": "vitest run"`, glob `convex/**/*.convex.spec.ts`, ~176 tests,
  ~12k lines of spec).
- `packages/shared` contains **four test files written with `node:test`**
  (`organizer-utils.test.ts`, `timer-utils.test.ts`,
  `organization-profile-image.test.ts`, `tournament-creation-utils.test.ts`)
  — but `packages/shared/package.json` has **no scripts block at all**. No
  `node --test` invocation exists anywhere in the repo. These tests are dead
  code: they have never run in CI or via any package script.
- No root `test` script in the workspace `package.json`.
- **No `.github/workflows` directory** — nothing runs any tests in CI.
- `packages/tournament-core`, `apps/web`, `apps/native`: zero test files, no
  test scripts.

**Pure, exported, risky — and unreachable by any runner:**

- `apps/web/src/components/player-controller/decklist/decklist-draft.ts`
  (139 lines) — quantity-parsing regex
  `/^\s*(\d{1,2})\s*[xX]?\s+(\S.*)$/`, case-insensitive merge, clamping,
  cross-board moves, and `draftsEqual` (drives the unsaved-changes blocker).
- `standingStatusLabel` (`packages/tournament-core/src/format.ts`) — 5-branch
  precedence ladder ("a drop or DQ outranks any playoff state").
- `effectiveRegistrationStatus`
  (`packages/shared/src/registration-status.ts`) — imported by both the
  organizer roster UI and the Convex backend; no test.
- Pure timeline functions inside
  `apps/web/src/components/organizer-workspace/tournament-manager/tournament-progress-bar.tsx`
  — `phaseSlots` (:76), `phaseStartNumbers` (:108), `activeRoundProgress`
  (:132), `betweenRoundTarget` (:156), `advanceAction` (:423) — all declared
  `function`, **not** `export function`, so nothing outside the 877-line
  component can reach them.

## Task

1. **Give every workspace a runner.** Add vitest (plain node environment;
   jsdom only where a test actually needs DOM) to `packages/shared`,
   `packages/tournament-core`, and `apps/web` (`apps/native` optional), with a
   `test` script in each `package.json`.
2. **Port the four `packages/shared` test files from `node:test` to vitest**
   (mechanical: swap imports/assertions) — or wire `node --test` if that is
   genuinely less work; the requirement is that `pnpm --filter
   @tournament-os/shared test` runs and passes.
3. **Add a root `test` script** that runs every workspace's tests
   (`pnpm -r test` or equivalent).
4. **Export the pure functions** listed above from the progress bar (just add
   `export`; do not move them — refactor 07 will relocate them) so they are
   testable.
5. **Write starter suites for the riskiest pure logic**: `decklist-draft.ts`
   (parse/add/move/clamp/`draftsEqual`), `effectiveRegistrationStatus`, and
   `standingStatusLabel`. These are the first tests in their workspaces —
   keep them plain-function tests, no React rendering needed.
6. **Optional but valuable:** a minimal GitHub Actions workflow running the
   root test script on PRs, since `.github/workflows` does not exist.

## Acceptance criteria

- `pnpm -r test` (or the root script you add) runs backend + shared +
  tournament-core + web suites; everything passes.
- The four formerly-dead shared test files execute and pass.
- `decklist-draft.ts`, `effectiveRegistrationStatus`, and
  `standingStatusLabel` each have a real suite.
- No behavioral changes to production code beyond adding `export` keywords.
