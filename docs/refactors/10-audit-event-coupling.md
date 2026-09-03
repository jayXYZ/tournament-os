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

Nothing structurally couples an audit event to the write it describes for the
handler-level call sites that remain, and several organizer actions are still
unlogged. The structural half of this refactor largely landed as a side
effect of the progression and match-result module extractions; the policy
table and the agreed gaps are the live work.

## Verified current state (checked 2026-08-29)

- **Logging now mostly lives with the writes.** `logAuditEvent` fires from
  the model modules that own the writes: `model/progression.ts` (6 sites,
  e.g. :721 `round_completed`, :766 `round_started`), `model/roster.ts`
  (11 sites), `model/matchResults.ts:208`. Only 4 handler-level call sites
  remain — `tournaments/lifecycle.ts:554,600`,
  `tournaments/registrations.ts:233`, `tournaments/decklists.ts:107` — plus
  the payments modules.
- **All timer mutations are silent**: `tournaments/timer.ts` has six
  mutations (`setRoundDuration:25`, `startTimer:42`, `pauseTimer:70`,
  `resumeTimer:94`, `adjustTimer:117`, `clearTimer:148`), zero
  `logAuditEvent` calls, and no timer event type in the validator union.
- **`deleteTournament` is unlogged**: `tournaments/lifecycle.ts:630` — the
  handler destroys the event and its entire audit trail with no record.
  (The trail's rows are deleted along with the tournament, so "logging" a
  deletion may mean something different — e.g. an org-level record — this is
  exactly the kind of policy question to settle first.)
- **`publishPairings` leaves no trace** (confirmed):
  `model/progression.ts:635-653` patches `pairingsPublishedAt` and returns
  with no event.
- `generateNextRound`'s event logs `step.round.roundNumber + 1`
  (`model/progression.ts:773`) rather than reading the round it just created.
  Confirmed correct today — the created round is assigned exactly that number
  (:809, :822, :893, :903) — but it is a fragile derivation worth tightening
  while in here, not a live bug.
- **Event payload shapes moved**: they are defined in
  `tournamentAuditEventValidator` at `validators.ts:367-545` (not
  `model/auditLog.ts`, which is now 79 lines of helpers only), and have grown
  ~10 payments/refund/payout/dispute event types.

## Task

1. **Write the policy table first** (a short doc or PR description): for
   every public mutation in `tournaments/` **and the payments/webhook/sweep
   mutations in `payments/`**, is its state change part of the tournament
   record? Deliberate omissions get documented as deliberate. Propose the
   table before implementing if anything is ambiguous.
2. **Finish moving logging inside the modules that own the writes** — only
   the 4 handler-level sites above remain. Prefer folding the log call into
   the model-level write helper the handler calls.
3. **Close the agreed gaps** from the policy table (likely candidates:
   `publishPairings`, timer start/pause/reset if deemed record-worthy,
   tournament deletion via whatever mechanism the policy chooses).
4. Keep `tournamentAuditEventValidator` in `validators.ts:367` as the single
   place event types are defined.

## Acceptance criteria

- A written policy table covering every mutating handler: logged (where) or
  deliberately silent (why).
- No handler performs a record-worthy write and separately remembers to log —
  the owning module emits the event.
- `tournaments-audit-log.convex.spec.ts` extended to cover the newly logged
  actions; full backend suite passes.
