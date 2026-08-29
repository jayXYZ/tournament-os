# Refactor 09 — One canonical fixture module for backend specs

## Context for the agent

You are working in `tournament-os`; the backend is Convex in
`packages/backend` with a vitest + convex-test suite (~309 tests, glob
`convex/**/*.convex.spec.ts`). **Read
`packages/backend/convex/_generated/ai/guidelines.md` first.**
Pre-production. Run with `pnpm --filter @tournament-os/backend test`.

This is a test-only refactor: production code must not change (with one
possible exception noted below).

## Problem

Spec setup is spread across four overlapping helper modules plus per-spec
local duplicates, and some seeding bypasses the public mutations entirely —
inserting rows the real registration path would reject — so tests can drift
from real write policy without failing. Notably, the _canonical_ fixture is
itself now a policy-bypassing seeder (see below).

## Verified current state (checked 2026-08-29)

- Helper modules: `packages/backend/convex/specHelpers.ts` (323 lines, now
  with scenario-named helpers — `seedTournamentWithPlayers` :140,
  `matchForPlayer` :230, `currentRound` :306),
  `specHelpers.runtime.ts` (98 lines, split out for bundling reasons),
  `model/testing.ts`, and `tournaments/testing.ts` (production code powering
  test tournaments; do not confuse it with spec helpers). 24 of 29 spec files
  import `specHelpers.ts`; the 5 that don't are pure-unit/structure specs.
- `playOutCurrentRound` is down to **two** definitions: the exported
  canonical one in `specHelpers.ts:92`, plus one surviving local copy in
  `tournaments.convex.spec.ts:5713` (the timer-spec copy is gone).
- **The flagship fixture bypasses registration policy**:
  `specHelpers.ts:183-221` (`seedTournamentWithPlayers`) raw-inserts
  `tournamentRegistrations` inside `t.run` and hand-patches
  `confirmedRegistrationCount` (:216-219), bypassing `registerSelf`
  (capacity, private-event rules, denormalized count maintenance). This is
  exactly the drift this doc warns about, centralized.
- `tournaments.convex.spec.ts` (5,873 lines) contains ~53 raw `t.run` seeds;
  `seedActiveRegistrations` (local, :5838) still raw-inserts registrations
  and is used ~20+ times.
- No `rawSeed` escape hatch or labeling convention exists yet.

## Task

1. **Keep consolidating on `specHelpers.ts`** as the one fixture module: its
   interface is **scenario names**, not row assembly — e.g.
   `activeSwissRound(t, {players})`, `completedRound(t, …)`,
   `tournamentReadyForCut(t, …)`, `fullDecklistEvent(t, …)`. (Adoption is
   already broad; this step is mostly about the remaining local seeders.)
2. **Reimplement the scenarios through public mutations** (the same seam real
   clients use: `registerSelf`, lifecycle mutations, round mutations, the
   test-tournament mutations where appropriate), starting with
   `seedTournamentWithPlayers` itself, so fixtures cannot drift from write
   policy.
3. **Delete the last duplicate `playOutCurrentRound`**
   (`tournaments.convex.spec.ts:5713`); all specs import the canonical one.
4. **Provide a labeled escape hatch** (e.g. `rawSeed(t, …)` with a comment
   convention) for states genuinely unreachable through the public seam, and
   convert existing raw `t.run` seeds to scenarios where a public path
   exists. Where `seedActiveRegistrations` was hiding a state that
   `registerSelf` would reject, decide per case: either the test wanted an
   impossible state (fix the test) or the public seam lacks a needed path
   (keep the labeled raw seed and note it).
5. Work incrementally — the main spec is 5,873 lines. Convert file by file,
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
