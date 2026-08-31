# Refactor 07 — Extract the tournament-timeline model from the progress bar

## Context for the agent

You are working in `paper-pairings`; the organizer web UI lives in
`apps/web/src/components/organizer-workspace/tournament-manager/`. The data
source is the Convex query `getPairingsBoard` (whose `nextStep` field comes
from `packages/backend/convex/model/nextStep.ts`, a deliberately deep module —
do not modify the backend in this refactor). Pre-production; no compatibility
constraints.

A web test runner exists (`apps/web/vitest.config.ts`, run via
`pnpm --filter web test`); only one web test file exists today, so the suite
you add here will be the second.

## Problem

`tournament-progress-bar.tsx` is an 809-line component that mixes pure
timeline interpretation (which phase/round slots exist, where the tournament
currently is, what the next advance action is) with presentation and mutation
wirings. The pure logic is module-private, so it cannot be tested without
rendering the whole bar, and a second "advance tournament" UI would have to
re-implement it.

## Verified current state (checked 2026-08-29)

- `apps/web/src/components/organizer-workspace/tournament-manager/tournament-progress-bar.tsx`
  (809 lines). Pure functions declared `function` (not exported): `phaseSlots`
  (:78), `activeRoundProgress` (:110), `betweenRoundTarget` (:132).
- `advanceAction` is no longer a module-level function — it is a closure
  nested inside the `AdvanceStepButton` component (:346). It must be hoisted
  out of the component before it can be extracted.
- `phaseStartNumbers` no longer exists: round-numbering math moved server-side
  as `phaseTimelines` (`packages/backend/convex/model/phases.ts:199`, tested
  in `timeline.convex.spec.ts`). The progress bar notes this at :73-77. Do
  not re-create it client-side.
- The stale-timer predicate was already extracted: `activeRoundTimer` at
  `round-timer-chip.tsx:17` (exported, reused by `round-timer-view.tsx:79`),
  with `inProgressRound` in `pairings-board.ts:10`. Consider relocating both
  into the new timeline module, but this half is done.
- `getPairingsBoard` subscribers are down from six to four:
  `tournament-progress-bar.tsx:230`, `pairings/pairings-view.tsx:25`,
  `standings-view.tsx:33`, `round-timer-view.tsx:45`
  (`pairings-settings-menu.tsx` now takes `board` as a prop).

## Task

1. **Extract a pure timeline module**, e.g.
   `tournament-manager/progression-timeline.ts`, containing `phaseSlots`,
   `activeRoundProgress`, `betweenRoundTarget`, and `advanceAction` (hoisted
   out of `AdvanceStepButton` first), plus the types they share, all exported.
   Plain functions over the board shape — no React. The progress bar becomes
   their view adapter.
2. **Unit-test the extracted functions** (plain vitest, no rendering):
   slot layout across multi-phase configs, active-round progress, the
   advance-action decision table, between-round targeting.
3. **Optional second step — one board subscription:** provide the pairings
   board from the manager layout (next to `ManagedTournamentProvider`) via a
   `usePairingsBoard()` context hook so the four subscriber files consume one
   subscription site. Convex `useQuery` deduplicates identical subscriptions
   under the hood, so this is a code-shape win more than a performance one —
   treat it as optional and keep the diff mechanical if you do it.

Keep this refactor frontend-only. Do not change query shapes or backend code.
Do not restyle anything — the component's rendering output must be pixel-
identical.

## Acceptance criteria

- `tournament-progress-bar.tsx` contains only rendering + mutation wiring;
  all timeline math is imported from the pure module.
- The pure module has a unit-test suite; tests run via `pnpm --filter web test`.
- No visual or behavioral change in the manager UI.
