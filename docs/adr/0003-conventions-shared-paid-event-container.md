# Conventions are a first-class container sharing the tournament payment engine

Conventions (umbrella events that span a date range, sell their own
registrations — badges — and hold tournaments) are a separate `conventions`
table rather than a flavored tournament row, with `tournaments.conventionId`
as the only hierarchy link: a tournament belongs to zero or one convention,
and conventions never nest. Badge registrations get their own
`conventionRegistrations` table because a badge has none of a tournament
entry's competitive state (participation status, tiebreakers, decklists,
standings write-through), so reusing `tournamentRegistrations` would have
meant dead fields on every badge and badge writes flowing through the
standings-coupled `setRegistrationState`.

Money deliberately goes the other way: badges reuse the tournament payment
tables and engine rather than getting parallel ones. `paymentOrders`,
`paymentRefunds`, `eventPayouts` (renamed from `tournamentPayouts`), and
`payoutTransfers` carry an exactly-one-of owner pair
(`tournamentId`/`conventionId`) whose table always matches `registrationId`'s,
enforced at the two insertion points (`createEntryOrder`, `queueRefund`). The
checkout attempt CAS, supersede proofs, webhook-only fulfillment, refund
idempotency, sweeps, and the greedy payout deduction are the subtlest code in
the repo; duplicating them per entity would double the audit surface of money
code and split webhook dispatch. The convention document reuses the tournament
paid-event field names (`entryFeeCents`, `refundDeadline`, `startDate`,
`lifecycle`, `playerCapacity`, `confirmedRegistrationCount`) so the payment
rules generalize structurally (`model/payments.ts`), and
`model/paidEvents.ts` is the single seam that resolves a money row back to
its owning entity — every cross-entity cast lives there.

Three behavioral decisions worth remembering: the badge gate
(`badgeRequiredForChildEvents`) is an admission gate, not a standing
entitlement — it is checked only at self-serve child-event registration time
(`registerSelf`, `beginEntryCheckout`), organizer verbs bypass it, and
cancelling a badge never revokes child registrations already made. Convention
and child-event fees are independent and additive, settling as separate
payouts (badge fees release when the organizer explicitly completes the
convention — it has no rounds to derive completion from). And a convention's
end never rewrites its children: cancelling leaves child events attached and
running (the UI warns), deleting force-detaches them, and attach/detach only
touch children still in setup or registration.

Decided 2026-08-29.
