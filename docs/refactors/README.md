# Architecture refactor records

These handoff prompts came out of a five-report architecture review
(2026-08-05/06). All ten original items are merged into `main` as of the
2026-10-28 audit. Seven handoff docs were deleted after implementation
(auth-readiness seam, progression module, test infrastructure,
participation/standings sync, player access ladder, match-result module,
current-match semantics; see git history for the original docs). The three
retained documents now describe implemented conventions, not unstarted work.

| #   | Doc                                                  | One-liner                                                        | Effort |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| 07  | [timeline-module](07-timeline-module.md)             | Done: timeline math in `progression-timeline.ts`, unit-tested    | Done   |
| 09  | [fixture-consolidation](09-fixture-consolidation.md) | Done: now documents the backend spec fixture conventions         | Done   |
| 10  | [audit-event-coupling](10-audit-event-coupling.md)   | Done: [audit policy](../audit-policy.md); events live in writes. | Done   |

Merge evidence: timeline PR #46 at `7c43ddd`, fixtures PR #45 at `36c7638`,
and audit coupling PR #43 at `54fb36d`. Remaining follow-ups are optional
timeline subscription consolidation and moving convention lifecycle writes
and their audit events into the model layer. They do not reopen the original
refactors. Deployment verification is a separate [delivery concern](../delivery-status.md).

## Standing constraints for every refactor

- Pre-production: no data migrations, no backward compatibility; reset the DB
  if a schema change would otherwise need a migration (see `AGENTS.md`).
- Read `packages/backend/convex/_generated/ai/guidelines.md` before touching
  Convex code (regenerate with `pnpm --filter @paper-pairings/backend exec convex ai-files install`
  when refreshing it; the generated guidance is tracked in git).
- Backend verification: `pnpm --filter @paper-pairings/backend test`.
- Do **not** break up these verified-deep modules — reuse them as internals:
  `model/nextStep.ts`, `model/pairing.ts`, `model/cutoffs.ts`,
  `model/standings.ts`, `setRegistrationState`'s transition typing (now in
  `model/participation.ts`), `decklist-draft.ts`, `SiteShell`, the
  batch-continuation deletion pair.
