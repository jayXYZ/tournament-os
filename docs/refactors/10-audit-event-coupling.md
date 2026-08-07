# Refactor 10 — Make the audit event part of the write

## Context for the agent

You are working in `tournament-os`; the backend is Convex in
`packages/backend`. **Read
`packages/backend/convex/_generated/ai/guidelines.md` first.**
Pre-production. Verify with `pnpm --filter @tournament-os/backend test`
(audit specs: `tournaments-audit-log.convex.spec.ts`).

**Important: this task starts with a policy decision, not code.** Some of the
unlogged mutations below may be deliberately silent (e.g. timer nudges
arguably don't belong in a player-visible trail). Step 1 is to enumerate and
propose; only then implement.

## Problem

`logAuditEvent` is an adjacent call each mutation handler must remember to
make. Nothing structurally couples the event to the write it describes, and
roughly half of mutating handlers omit it — including some advertised
organizer actions.

## Verified current state (checked 2026-08-07)

- `packages/backend/convex/model/auditLog.ts` — `logAuditEvent`, called from
  7 modules (`model/tournaments.ts`, `tournaments/registrations.ts`,
  `tournaments/player.ts`, `tournaments/playerMeeting.ts`,
  `tournaments/lifecycle.ts`, `tournaments/decklists.ts`,
  `tournaments/rounds.ts`), ~17 call sites total.
- **All timer mutations are silent**: `tournaments/timer.ts` contains zero
  `logAuditEvent` calls.
- **`deleteTournament` is unlogged**: `tournaments/lifecycle.ts:604` — the
  handler destroys the event and its entire audit trail with no record.
  (Note the trail's rows are deleted along with the tournament, so "logging"
  a deletion may mean something different — e.g. an org-level record — this
  is exactly the kind of policy question to settle first.)
- Reported but **unverified** (check during the work): `publishPairings`
  leaves no trace, and `generateNextRound`'s audit event records
  `currentRound.roundNumber + 1` rather than reading the round it just
  created — confirm and fix if true.

## Task

1. **Write the policy table first** (a short doc or PR description): for
   every public mutation in `tournaments/`, is its state change part of the
   tournament record? Deliberate omissions get documented as deliberate.
   Propose the table before implementing if anything is ambiguous.
2. **Move logging inside the modules that own the writes**, so a write and
   its event are emitted by the same interface and new handlers cannot
   silently skip logging:
   - If refactor 02 (progression module) exists, its `advance`/`rewind` own
     their events.
   - If refactor 06 (match-result module) exists, `applyMatchResult` owns
     result events.
   - For the rest, prefer folding the log call into the model-level write
     helper the handler calls, rather than leaving it in the handler.
3. **Close the agreed gaps** from the policy table (likely candidates:
   `publishPairings`, timer start/pause/reset if deemed record-worthy,
   tournament deletion via whatever mechanism the policy chooses).
4. Keep the event payload shapes in `model/auditLog.ts` as the single place
   event types are defined.

## Acceptance criteria

- A written policy table covering every mutating handler: logged (where) or
  deliberately silent (why).
- No handler performs a record-worthy write and separately remembers to log —
  the owning module emits the event.
- `tournaments-audit-log.convex.spec.ts` extended to cover the newly logged
  actions; full backend suite passes.

## Sequencing

Lowest priority of the ten refactor docs. Do it after refactors 02 and 06 if
those are planned — they create the module homes this one wants to put events
into.
