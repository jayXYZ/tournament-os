# Refactor 04 — Hide StandingsSync behind participation transitions

## Context for the agent

You are working in `tournament-os`; the backend is Convex in
`packages/backend`. **Read
`packages/backend/convex/_generated/ai/guidelines.md` before touching Convex
code.** Pre-production: no data migrations needed. Verify with
`pnpm --filter @tournament-os/backend test`.

## Problem

`participationStatus` is denormalized onto standings rows. Keeping the
registration row and the latest standings rows consistent currently depends on
**caller-chosen strategy and call ordering**: every caller that changes a
player's participation (drop, reinstate, eliminate, rewind-restore) must pick
the right `StandingsSync` variant and preserve write order. The strategy leaks
across the seam — so thoroughly that a structure spec enforces the invariants
by regex-grepping source code, because no behavioral test can observe them.

## Verified current state (checked 2026-08-07)

- `packages/backend/convex/model/registrations.ts:345-393` — the leaking
  interface: `StandingsSyncRow`, `StandingsSync` union with kinds
  `"prefetchedRound"` (:356) and `"deferredToCaller"` (:361), exported
  constant `DEFERRED_STANDINGS_SYNC` (:363), `prefetchStandingsSync` (:393).
  `setRegistrationState` (~:414) takes an optional `standingsSync?` parameter;
  a comment at ~:472 explains "A caller changing many registrations at once
  passes a StandingsSync instead".
- Callers threading the strategy: `tournaments/rounds.ts` (single-elim
  eliminations around :478–488 must run `replaceStandingsForRound` **before**
  `eliminateSingleEliminationLosers`; rewind restore around :559 and :832),
  `model/singleElimination.ts` (~:198 `eliminateSingleEliminationLosers`),
  cutoff eliminations via `eliminateNonQualifiers` (rounds.ts:314).
- `packages/backend/convex/tournaments.structure.convex.spec.ts` — reads
  source with `readFileSync` and asserts, among other things, the count of
  `DEFERRED_STANDINGS_SYNC,` occurrences in the rewind-restore body (:159)
  and that restore happens before standings deletion; also greps
  `tournaments/player.ts` for `standing.participationStatus` usage (:124-130).
  Its own comment admits: "which no behavioural test can protect because both
  designs return the same rows."

## Task

Deepen a **player-participation module** (inside `model/registrations.ts` or a
new `model/participation.ts`) whose interface names participation changes, not
sync mechanics:

- Operations like `dropPlayer`, `reinstatePlayer`,
  `eliminatePlayers(byRoundId)`, `restoreEliminationsForRewind` — each owns
  the registration-row transition **and** the latest-standings repair
  internally, including batch modes and write ordering.
- `StandingsSync`, `DEFERRED_STANDINGS_SYNC`, `prefetchStandingsSync`, and the
  `standingsSync?` parameter disappear from the public surface of the model —
  they become internals (or are deleted if the internal design no longer
  needs the strategy split).
- Callers in `tournaments/rounds.ts`, `tournaments/registrations.ts`,
  `model/singleElimination.ts`, and cutoff application pass only the
  participation change they want.

Keep the `setRegistrationState` union typing that makes illegal registration
transitions unrepresentable — that part is verified-good design; the problem
is only the sync-strategy leak around it.

Replace the structure-spec source-greps with behavioral tests through the new
interface (e.g., after rewind, the restored standings rows carry the correct
`participationStatus`), then delete the greps they replace.

## Acceptance criteria

- No file outside the participation module mentions
  `DEFERRED_STANDINGS_SYNC`, `prefetchedRound`, or `deferredToCaller`.
- Rewind restore-before-delete ordering is internal to the module and covered
  by a behavioral test, not a source grep.
- All backend tests pass.

## Related work

If refactor 02 (progression module) is planned, do 02 first — this module
becomes its largest internal seam and the call sites you must convert are the
same ones 02 rewrites.
