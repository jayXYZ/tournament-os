# Refactor 10 — Audit events belong to the write

Completed. [The audit policy](../audit-policy.md) inventories tournament and
payment entry points and explains deliberate omissions, including configuration,
provider bookkeeping, automatic lifecycle cleanup, and hard deletion.

Tournament publication/cancellation, self-registration, and decklist submission
now perform their writes and append their events inside the owning model
operation. Public handlers validate arguments and access, then delegate.
Explicit pairings publication logs once, and round-start events read the created
round's actual number.

`model/timer.ts` owns timer validation, writes, and logging. Default-duration
changes record old/new values; timer actions record their operation and
before/after anchors. Clearing an absent timer and setting the same stored
default duration append nothing. Automatic lifecycle cleanup remains represented
by its lifecycle event.

Keep event shapes in `validators.ts` and handle every event in the organizer
journal UI. New mutating entry points must update the policy inventory.
`tournaments-audit-log.convex.spec.ts` covers publication authorization and
idempotency, timer anchors, no-ops, and failed operations. Verify backend changes
with `pnpm --filter @tournament-os/backend test`; the full gate is `pnpm check`.
