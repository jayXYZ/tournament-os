# Architecture refactor backlog

These handoff prompts came out of a five-report architecture review
(2026-08-05/06). The original backlog had ten items; seven landed and were
deleted (auth-readiness seam, progression module, test infrastructure,
participation/standings sync, player access ladder, match-result module,
current-match semantics — see git history for the original docs). The
remaining docs were re-verified against the codebase on 2026-08-29; file:line
references were accurate at that point.

| #   | Doc                                                  | One-liner                                                        | Effort |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| 07  | [timeline-module](07-timeline-module.md)             | Pure timeline math out of the 809-line progress bar              | Small  |
| 09  | [fixture-consolidation](09-fixture-consolidation.md) | Fixtures through public mutations; delete the last duplicate     | Medium |
| 10  | [audit-event-coupling](10-audit-event-coupling.md)   | Audit policy table, then close the timer/delete/publish log gaps | Medium |

All three are independent of each other.

## Standing constraints for every refactor

- Pre-production: no data migrations, no backward compatibility; reset the DB
  if a schema change would otherwise need a migration (see `AGENTS.md`).
- Read `packages/backend/convex/_generated/ai/guidelines.md` before touching
  Convex code (regenerate with `pnpm --filter @paper-pairings/backend exec convex ai-files install`
  if missing — it is gitignored).
- Backend verification: `pnpm --filter @paper-pairings/backend test`.
- Do **not** break up these verified-deep modules — reuse them as internals:
  `model/nextStep.ts`, `model/pairing.ts`, `model/cutoffs.ts`,
  `model/standings.ts`, `setRegistrationState`'s transition typing (now in
  `model/participation.ts`), `decklist-draft.ts`, `SiteShell`, the
  batch-continuation deletion pair.
