# Refactor 06 — One match-result writer with three adapters

## Context for the agent

You are working in `tournament-os`; the backend is Convex in
`packages/backend`. **Read
`packages/backend/convex/_generated/ai/guidelines.md` before touching Convex
code.** Pre-production: no migrations needed. Verify with
`pnpm --filter @tournament-os/backend test` (player-path specs live in
`tournaments-player.convex.spec.ts`).

## Problem

Recording a match result — compute match points, patch both player pairing
rows, patch the match status, append an audit event — is implemented three
times in three files with near-identical bodies. Only two of the three append
audit state. Validation (decisive-elimination results, two-player checks) is
also repeated. The copies can and will drift.

## Verified current state (checked 2026-08-07)

Three write paths, each performing the same patch triple (two player rows +
match status):

1. **Organizer**: `recordMatchResult` in
   `packages/backend/convex/tournaments/rounds.ts:351-440` — validates round
   in-progress, `requireDecisiveEliminationResult`, exactly-two-players,
   `matchPointsForResult`, captures `existingResultLines` (edit-vs-create for
   the log), patches both rows (:398-410), patches match with
   `matchStatus: "completed"` and `reportedByRegistrationId: undefined`
   (organizer supersedes player reports, :411-416), then `logAuditEvent`
   (:416+).
2. **Player**: `reportMyMatchResult` in
   `packages/backend/convex/tournaments/player.ts:298-360` — same points
   computation and patch triple (:325-342), but sets
   `reportedByRegistrationId: myRow.playerId`, guards
   `matchStatus !== "upcoming"`, then `logAuditEvent` with player actor.
   (`confirmMatchResult` just below flips status to `"confirmed"`.)
3. **Test simulation**: `generateTestResults` in
   `packages/backend/convex/model/testing.ts:156-210` — same
   `requireDecisiveEliminationResult` + `matchPointsForResult` + patch triple
   (:193-208), **no audit event**.

Shared helpers already exist (`matchPointsForResult`,
`requireDecisiveEliminationResult`, `matchPlayers`) — the duplication is the
orchestration around them.

## Task

Add one model-level writer, e.g. `applyMatchResult` in a
`model/matchResults.ts` (or an existing appropriate model file), that owns:

- validation (decisive-elimination rule, two players, status preconditions
  expressed as policy),
- the points computation and the three patches,
- the audit event, shaped by an actor/policy argument.

The three call sites become adapters that differ only in policy:

- organizer: supersedes player reports (`reportedByRegistrationId:
  undefined`), allowed to overwrite an existing result, organizer-actor audit
  including previous-result lines;
- player: only on `"upcoming"` matches, stamps
  `reportedByRegistrationId`, player-actor audit;
- test simulation: seeded results, skips already-completed matches; decide
  explicitly whether the test path logs audit events (today it does not — if
  you keep that, make it an explicit policy flag, not an omission).

Do not change the public function signatures of `recordMatchResult`,
`reportMyMatchResult`, or the testing entry points — clients depend on them;
only their bodies shrink.

## Acceptance criteria

- The two-row + match patch sequence exists exactly once.
- All three paths pass through the same writer; behavioral differences are
  named policy inputs, not divergent copies.
- Existing backend tests pass unchanged (they exercise all three paths).
- Audit behavior is identical for organizer and player paths; test-path audit
  behavior is an explicit decision.
