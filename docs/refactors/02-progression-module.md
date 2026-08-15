# Refactor 02 — One tournament-progression module behind the model seam

## Context for the agent

You are working in `tournament-os`, a pnpm monorepo with a Convex backend in
`packages/backend`. **Read `packages/backend/convex/_generated/ai/guidelines.md`
before touching any Convex code.**

The project is **pre-production**: no data migrations or backward compatibility
are needed; if a schema change would require migrating data, reset the DB
instead. Verify with `pnpm --filter @tournament-os/backend test` (vitest +
convex-test; the main spec `tournaments.convex.spec.ts` is 4,706 lines).

## Problem

"Advance the tournament" (complete round → recompute standings → apply cutoff →
eliminate → pair next round → phase/lifecycle transitions → timer → audit) has
no module of its own. The orchestration lives in the public Convex endpoint
file `packages/backend/convex/tournaments/rounds.ts` (921 lines), and its
readiness rules exist **twice**: once in `model/nextStep.ts` (for the pairings
board read path) and once in the mutations. Every caller must re-derive the
sequencing, and one caller already copied it wrong.

## Verified current state (checked 2026-08-07)

**The rulebooks admit they mirror each other:**

- `packages/backend/convex/model/tournaments.ts:219` — comment: "(mirrors
  pairingsNextStep, …)" inside `completeTournament` (~L203–268).
- `packages/backend/convex/tournaments/testing.ts:191` — comment: "Keep this
  shortcut aligned with completeRound: …".

**Ordering rules enforced only by comments in `rounds.ts`** (all verified to
exist; line numbers approximate):

1. `resolvePhaseTotalRounds` patches the phase, then callers must rebuild a
   local copy `{ ...phase, phaseTotalRounds }` (rounds.ts ~101, ~282).
2. Callers pick `requireResolvedPhaseTotalRounds` vs `resolvePhaseTotalRounds`
   by code path (~167).
3. Continue-vs-advance decided by `roundNumberInPhase`, re-derived in three
   places (rounds.ts ~167, model/nextStep.ts ~185, tournaments/player.ts ~147).
4. Create the next round before applying the cutoff; stamp eliminations with
   the completed round's id (~309, `eliminateNonQualifiers` call at :314).
5. `phaseStatus` and `playerMeetingStatus` must be patched together — four
   sites (~114, ~316, ~601, ~615).
6. `replaceStandingsForRound` before `eliminateSingleEliminationLosers`,
   threading `StandingsSync` (~478–488).
7. Clear the round timer when the round completes (rounds.ts:504–507 patches
   `roundTimer: undefined` when `tournament.roundTimer?.roundId === args.roundId`);
   defensive re-clear at ~159–163.
8. On rewind, restore eliminations **before** deleting standings — enforced by
   a structure spec that regex-greps the source
   (`tournaments.structure.convex.spec.ts:144-159`).
9. `logAuditEvent` last (sites at rounds.ts:126, :173, :416, :518, :635).

**The drift already happened.** `advanceTestRound`
(`packages/backend/convex/tournaments/testing.ts:175-222`) re-implements the
advance sequence by hand (`generateTestResults` → `replaceStandingsForRound` →
patch round completed → maybe `completeTournament` → `createRoundWithPairings`
→ patch phase) and **omits**: the single-elimination elimination batch, the
round-timer clear, and the audit event. A second caller copied the sequence
and got it wrong — proof the sequencing is real complexity with nowhere to
live.

## Task

Create a `model/progression` (or `model/roundTransitions`) module whose
interface is the transitions themselves, roughly:

- `allowedActions(ctx, tournamentId) → { actions, reasons }` — the **single
  rulebook**. `pairingsNextStep` (the board read path) renders this same
  object; mutations refuse anything it does not allow. This kills the
  dual-rulebook drift between `model/nextStep.ts` and the mutations.
- `advance(ctx, tournamentId) → AdvanceOutcome` — owns the full sequence
  (rules 1–9 above) including elimination batches, meeting-status transitions,
  timer clear, phase/lifecycle completion, and the audit event.
- `rewind(ctx, tournamentId)` — owns restore-before-delete ordering internally.

Then:

- `tournaments/rounds.ts` endpoints shrink to auth + args + one call
  (adapters). Same for the relevant paths in `tournaments/lifecycle.ts`
  (`completeTournament` callers) and `tournaments/playerMeeting.ts` where they
  duplicate readiness rules.
- `advanceTestRound` in `tournaments/testing.ts` calls the same module (with a
  test-policy adapter for auto-publishing pairings) so the test path can no
  longer drift.
- The structure-spec source-greps that pin ordering
  (`tournaments.structure.convex.spec.ts`) should become behavioral tests
  against the new interface where possible; delete the greps they replace.

## Do NOT tear down (verified deep modules — keep as internals)

`model/nextStep.ts` (the discriminated-union builder — reuse it as the read
projection of `allowedActions`), `model/pairing.ts` (508 lines of Swiss
bracketing), `model/cutoffs.ts`, `model/standings.ts`
(`replaceStandingsForRound`), `setRegistrationState` in
`model/registrations.ts`. They become internals of the progression module,
not casualties.

## Acceptance criteria

- One implementation of the advance/rewind sequence; `rounds.ts` and
  `testing.ts` contain no orchestration, only adapters.
- `advanceTestRound` performs (or intentionally, explicitly skips via policy
  flag) the elimination batch, timer clear, and audit steps.
- Readiness rules exist once; board and mutations cannot disagree.
- All existing backend tests pass (adjusting tests whose assertions encoded
  the old split is fine; deleting source-grep structure tests that the new
  seam makes observable behaviorally is encouraged).

## Related work

Refactor 04 (StandingsSync/participation) and the phase-entry-cut concept are
natural **internal seams of this module** — if both are being done, do this
one first and fold 04's participation module in behind it.
