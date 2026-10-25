# Refactor 10 — The audit event is part of the write

Completed. [The audit policy](../audit-policy.md) inventories every tournament
and payments entry point (plus a summary for conventions) and records the
deliberate omissions: configuration and invite-link administration, provider
bookkeeping, side effects folded into their enclosing operation's event, and
hard deletion, which purges the journal and leaves no record.

What landed:

- Tournament publication and cancellation (`model/progression.ts`),
  self-registration (`model/roster.ts` `registerEntry`), and decklist
  submission (`model/decklists.ts` `submitDecklist`) now write and append
  their events inside the owning model function. Their endpoints resolve
  auth, rate limits, and the caller's rows, then delegate.
- `publishPairings` logs `pairings_published` once, with the organizer and
  round number; publishing already-public pairings appends nothing.
- `round_started` reads the created round's stored number instead of
  re-deriving it.
- `model/timer.ts` owns the timer controls: `round_duration_changed` (old and
  new default, only on an actual change) and `round_timer_changed` (operation
  plus the stored timer before and after). Clearing an absent timer appends
  nothing; lifecycle cleanup of the timer stays inside its lifecycle event.

Conventions to keep:

- Event shapes live only in `tournamentAuditEventValidator` /
  `conventionAuditEventValidator` (`validators.ts`); player references come
  from the `model/auditLog.ts` constructors.
- The model function that performs a record-worthy write emits its event;
  handlers never write and then separately remember to log.
- A new mutating entry point gets a row in the policy, a behavioral spec for
  any event it records, and an arm in `audit-event-text.ts` (the typecheck
  enforces the last).

Coverage: `tournaments-audit-log.convex.spec.ts` (publication authorization
and idempotency, timer anchors and no-ops, lifecycle timer cleanup, refused
writes, `round_started` numbering). Verify with
`pnpm --filter @paper-pairings/backend test`; the full gate is `pnpm check`.

Left open: convention lifecycle transitions (`conventions/lifecycle.ts`) still
write and log in their handlers.
