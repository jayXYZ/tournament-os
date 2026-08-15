# Refactor 07 — Extract the tournament-timeline model from the progress bar

## Context for the agent

You are working in `tournament-os`; the organizer web UI lives in
`apps/web/src/components/organizer-workspace/tournament-manager/`. The data
source is the Convex query `getPairingsBoard` (whose `nextStep` field comes
from `packages/backend/convex/model/nextStep.ts`, a deliberately deep module —
do not modify the backend in this refactor). Pre-production; no compatibility
constraints.

**Dependency note:** refactor 03 may already have added `export` to the pure
functions and a web test runner. Check before redoing that work.

## Problem

`tournament-progress-bar.tsx` is an 877-line component that mixes pure
timeline interpretation (which phase/round slots exist, where the tournament
currently is, what the next advance action is) with presentation and eight
mutation wirings. The pure logic is module-private, so it cannot be tested
without rendering the whole bar, and a second "advance tournament" UI would
have to re-implement it. Separately, six files each subscribe to
`getPairingsBoard` on their own.

## Verified current state (checked 2026-08-07)

- `apps/web/src/components/organizer-workspace/tournament-manager/tournament-progress-bar.tsx`
  (877 lines). Pure, dependency-injectable functions declared `function` (not
  exported): `phaseSlots` (:76), `phaseStartNumbers` (:108),
  `activeRoundProgress` (:132), `betweenRoundTarget` (:156), `advanceAction`
  (:423). Presentation components (`AdvanceStepButton` :335, `PhaseSection`
  :513, `RoundNode` :697, etc.) interleave with them in one file.
- Six files in the manager reference `getPairingsBoard`:
  `tournament-progress-bar.tsx`, `pairings/pairings-view.tsx`,
  `standings-view.tsx`, `round-timer-view.tsx`, `round-timer-chip.tsx`,
  `pairings/pairings-settings-menu.tsx`.
- `round-timer-chip.tsx:20` encodes a stale-timer rule ("a timer whose
  roundId ≠ the in-progress round is stale — show nothing") that lives only
  in that component file.

## Task

1. **Extract a pure timeline module**, e.g.
   `tournament-manager/progression-timeline.ts`, containing `phaseSlots`,
   `phaseStartNumbers`, `activeRoundProgress`, `betweenRoundTarget`,
   `advanceAction` (and the types they share), all exported. Plain functions
   over the board shape — no React. The progress bar becomes their view
   adapter.
2. **Unit-test the extracted functions** (plain vitest, no rendering):
   slot layout across multi-phase configs, active-round progress, the
   advance-action decision table, between-round targeting.
3. **Optional second step — one board subscription:** provide the pairings
   board from the manager layout (next to `ManagedTournamentProvider`) via a
   `usePairingsBoard()` context hook so the six subscriber files consume one
   subscription site. Convex `useQuery` deduplicates identical subscriptions
   under the hood, so this is a code-shape win more than a performance one —
   treat it as optional and keep the diff mechanical if you do it.
4. While extracting, move the stale-timer predicate from
   `round-timer-chip.tsx:20` into the timeline module (exported) so other
   surfaces can reuse it.

Keep this refactor frontend-only. Do not change query shapes or backend code.
Do not restyle anything — the component's rendering output must be pixel-
identical.

## Acceptance criteria

- `tournament-progress-bar.tsx` contains only rendering + mutation wiring;
  all timeline math is imported from the pure module.
- The pure module has a unit-test suite; tests run via the web test script.
- No visual or behavioral change in the manager UI.
