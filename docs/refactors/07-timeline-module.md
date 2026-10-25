# Tournament timeline model

Completed: the timeline's slot layout (`phaseSlots`), the active round's step
(`activeRoundProgress`), the between-rounds target (`betweenRoundTarget`), and
the advance control's label, title, and selection reset (`advanceAction`) live
in the pure
`apps/web/src/components/organizer-workspace/tournament-manager/progression-timeline.ts`
module, covered by `progression-timeline.test.ts` (plain vitest, no
rendering).

`tournament-progress-bar.tsx` renders those answers and wires the advance
action's icon and mutation. Conventions for further timeline work:

- Round numbering and progression readiness stay with the backend
  (`model/phases.ts` `phaseTimelines`, `model/nextStep.ts`). The module only
  shapes the board's projection into nodes; do not re-derive either rule
  client-side.
- The advance control's copy comes from `describeNextStep` (`next-step.ts`)
  through `advanceAction`, so the button, the live band, and the overview
  body say the same thing. A second advance surface should call
  `advanceAction` rather than re-implement its density rules.
- Per-node rendering choices (connector fill, link destination, tooltip copy)
  stay in the bar's components.

The four `getPairingsBoard` subscriptions remain in place. Consolidating them
through a context hook is optional; Convex already deduplicates identical
subscriptions.
