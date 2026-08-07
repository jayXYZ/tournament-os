# Refactor 09 — One canonical fixture module for backend specs

## Context for the agent

You are working in `tournament-os`; the backend is Convex in
`packages/backend` with a vitest + convex-test suite (~176 tests, glob
`convex/**/*.convex.spec.ts`). **Read
`packages/backend/convex/_generated/ai/guidelines.md` first.**
Pre-production. Run with `pnpm --filter @tournament-os/backend test`.

This is a test-only refactor: production code must not change (with one
possible exception noted below).

## Problem

Spec setup is spread across three overlapping helper modules plus per-spec
local duplicates, and some seeding bypasses the public mutations entirely —
inserting rows the real registration path would reject — so tests can drift
from real write policy without failing.

## Verified current state (checked 2026-08-07)

- Helper modules: `packages/backend/convex/specHelpers.ts` (87 lines),
  `packages/backend/convex/model/testing.ts` (211), and
  `packages/backend/convex/tournaments/testing.ts` (315 — this one is
  production code powering test tournaments; do not confuse it with spec
  helpers).
- `playOutCurrentRound` is defined **three times**: the exported canonical
  one in `specHelpers.ts:57`, plus local copies in
  `tournaments.convex.spec.ts:4605` and
  `tournaments-timer.convex.spec.ts:477`.
- `tournaments.convex.spec.ts` (4,706 lines) contains ~50 raw `t.run` seeds;
  `seedActiveRegistrations` (used at :163, :1639, :1740 and elsewhere)
  inserts registration rows directly, bypassing `registerSelf`'s policy
  (capacity, private-event rules, denormalized count maintenance).

## Task

1. **Consolidate on one fixture module** (grow `specHelpers.ts` or replace it
   with a `convex/specFixtures.ts`): its interface is **scenario names**, not
   row assembly — e.g. `activeSwissRound(t, {players})`,
   `completedRound(t, …)`, `tournamentReadyForCut(t, …)`,
   `fullDecklistEvent(t, …)`.
2. **Implement scenarios through public mutations only** (the same seam real
   clients use: `registerSelf`, lifecycle mutations, round mutations, the
   test-tournament mutations where appropriate), so fixtures cannot drift
   from write policy.
3. **Delete the two duplicate `playOutCurrentRound` definitions**; all specs
   import the canonical one.
4. **Provide a labeled escape hatch** (e.g. `rawSeed(t, …)` with a comment
   convention) for states genuinely unreachable through the public seam, and
   convert existing raw `t.run` seeds to scenarios where a public path
   exists. Where `seedActiveRegistrations` was hiding a state that
   `registerSelf` would reject, decide per case: either the test wanted an
   impossible state (fix the test) or the public seam lacks a needed path
   (keep the labeled raw seed and note it).
5. Work incrementally — the main spec is 4,706 lines. Convert file by file,
   keeping the suite green after each file. Do not rewrite assertions, only
   setup.

## Acceptance criteria

- One `playOutCurrentRound`; zero local redefinitions.
- New/converted fixtures go through public mutations; remaining raw seeds are
  explicitly labeled with why the public seam can't produce that state.
- Full backend suite passes with the same test count (or document any test
  that turned out to be asserting an unreachable state).
- No production-code changes (if a scenario genuinely needs a new internal
  testing mutation, propose it in the PR description rather than silently
  adding one).
