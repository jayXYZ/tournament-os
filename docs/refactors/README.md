# Architecture refactor backlog

Ten self-contained handoff prompts, each written for a fresh agent with no
prior context. They came out of a five-report architecture review
(2026-08-05/06) whose overlapping findings were verified against the codebase
at commit `56c416e` on 2026-08-07 — every file:line reference in these docs
was checked at that point. If much time has passed, re-verify line numbers
before editing; the claims themselves were accurate as written.

Ranked by importance (verified correctness risk × leverage × cost):

| #   | Doc                                                                | One-liner                                                              | Effort |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------ |
| 01  | [auth-readiness-seam](01-auth-readiness-seam.md)                   | One hook owns "wait for Convex auth"; fixes a live gap in player-home  | Small  |
| 02  | [progression-module](02-progression-module.md)                     | One rulebook + one advance/rewind implementation behind the model seam | Large  |
| 03  | [test-infrastructure](03-test-infrastructure.md)                   | Runners for shared/core/web; revive 4 dead test files; export pure fns | Small  |
| 04  | [participation-standings-sync](04-participation-standings-sync.md) | Hide StandingsSync strategy behind participation transitions           | Medium |
| 05  | [player-access-ladder](05-player-access-ladder.md)                 | One five-state access module for /play and /decklist                   | Medium |
| 06  | [match-result-module](06-match-result-module.md)                   | One match-result writer, three policy adapters                         | Small  |
| 07  | [timeline-module](07-timeline-module.md)                           | Pure timeline math out of the 877-line progress bar                    | Small  |
| 08  | [current-match-semantics](08-current-match-semantics.md)           | describeCurrentMatch shared by web + native; model/playerView          | Medium |
| 09  | [fixture-consolidation](09-fixture-consolidation.md)               | One spec-fixture module through public mutations                       | Medium |
| 10  | [audit-event-coupling](10-audit-event-coupling.md)                 | Policy first, then events emitted by the modules that write            | Medium |

## Sequencing constraints

- **03 first or early** — it creates the runners other refactors' acceptance
  criteria assume (01, 05, 07, 08 all want frontend/shared tests).
- **01 before 05** — the access ladder consumes the auth-readiness hook.
- **02 before 04 and 10** — the progression module is the home 04 folds into
  and 10 puts events into. 04 can also run standalone if 02 is deferred.
- **06 before 10** (if both planned) — same reason.
- 07, 08, 09 are independent of everything else.

Independent tracks that can run in parallel: {01→05}, {03}, {02→04},
{06}, {07}, {08}, {09}.

## Standing constraints for every refactor

- Pre-production: no data migrations, no backward compatibility; reset the DB
  if a schema change would otherwise need a migration (see `AGENTS.md`).
- Read `packages/backend/convex/_generated/ai/guidelines.md` before touching
  Convex code.
- Backend verification: `pnpm --filter @tournament-os/backend test`.
- Do **not** break up these verified-deep modules — reuse them as internals:
  `model/nextStep.ts`, `model/pairing.ts`, `model/cutoffs.ts`,
  `model/standings.ts`, `setRegistrationState`'s transition typing,
  `decklist-draft.ts`, `SiteShell`, the batch-continuation deletion pair.
