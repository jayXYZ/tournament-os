# Tournament timeline presentation

Completed: the timeline slot layout, active-round progress, between-round
selection, and advance-action descriptions live in the pure
`apps/web/src/components/organizer-workspace/tournament-manager/progression-timeline.ts`
module, covered by `progression-timeline.test.ts`.

`tournament-progress-bar.tsx` renders those descriptions and wires their
commands to Convex mutations. Round numbering and progression readiness
remain owned by the backend. Keep additional timeline surfaces on the same
projection rather than recreating the rules.

The existing identical board subscriptions remain in place. Consolidating
those through context is optional; Convex already deduplicates subscriptions.
