# Convention ticketing is composed from ticket-type rows, not a single fee

A convention no longer carries one `entryFeeCents`; it sells zero or more
rows of a new `conventionTicketTypes` table, and every badge records which
type it is (`conventionRegistrations.ticketTypeId`). A ticket type composes
four orthogonal fields — price (`priceCents`, 0 = free), an optional
per-type capacity (`capacity`/`confirmedCount`, inside the convention's
global `playerCapacity`), an optional admission window
(`admissionStartDate`/`admissionEndDate`, absent = the whole convention;
a day pass is a one-day window), and comped child events
(`includedTournamentIds`) — so "one ticket price" is one type, "day passes
plus a weekend pass" is three types differing only in admission window, and
"VIP" is a type with a higher price and included events. Deliberately no
entitlement rules engine: composition is fields on a row, and new pass
shapes should be new fields, not a DSL. `createConvention` seeds one free
"General admission" type so the free-convention flow works out of the box.
This is pre-production; `entryFeeCents` is dropped and the database reset
rather than migrated.

The convention lifecycle loses its "in_progress" phase — it was borrowed
tournament shape with no job of its own here. Conventions get their own
validator (`setup | registration | completed | cancelled`, no longer
aliasing the tournament one), where "registration" now means the whole live
run: publish opens it, the organizer's explicit complete (still the payout
trigger) or cancel ends it, and `startConvention` and its close-orders
sweep are deleted (`completeConvention` already closes open orders before
paying out). The `"registration"` literal is deliberately kept so the
payment engine's structural reads (`isEntrySeatable`, the capacity guards)
are untouched. Two knock-ons are accepted: the player-cancel refund default
anchors to the start date rather than the lifecycle
(`refundDeadline ?? startDate` — with registration spanning the live con,
"refundable while cancellable" would let an attendee self-refund
mid-convention), and "pre-start editable" setup fields (dates, capacity,
badge gate) stay editable for the whole run.

Selling is governed by a sale window, not lifecycle or an archived flag:
each type has an optional `saleStartDate`/`saleEndDate`, and a type is
purchasable only while the convention's lifecycle is "registration" AND now
is inside the window — which, with the lifecycle change above, is what
makes door sales possible (mid-con purchases were the deliberate gap ADR
0003 noted). The effective sale end defaults to the admission end
(`saleEndDate ?? admissionEndDate ?? convention.endDate`), and an explicit
`saleEndDate` may never exceed that bound — you must not be able to buy a
day pass for a day already over. Stopping a sale is setting `saleEndDate`
into the past; hard-deleting a type is allowed only while no order
references it. Ticket types have no visibility of their own — they are
public exactly when their convention is (`isConventionPubliclyViewable`),
so a private or unpublished convention exposes no types, prices, or
availability through any public read.

Money changes stay at the seam, because the order's snapshotted
`amountBreakdown` already insulates refunds, payouts, and sweeps from
pricing: `createEntryOrder` takes the resolved price from its caller
(tournaments still pass `event.entryFeeCents`; badge checkout passes the
chosen type's `priceCents`) and stamps `ticketTypeId` onto the order —
set exactly when `conventionId` is set. The fee freeze moves per type: a
type's price locks once any order references it (same rationale as the
event-level freeze — no order status is safe to reprice around), while new
types can be added any time before the convention starts. The webhook's
seat decision and the badge exit adjust the type's `confirmedCount`
alongside the convention counter, and the existing `seat_unavailable`
refund covers a type selling out mid-checkout. One badge per participant
remains the invariant — a Saturday+Sunday attendee buys the weekend pass —
and a checkout begun for a different type than the open order's closes that
order and expires its session through the existing supersede machinery
rather than repricing a live snapshot.

Entitlements ride the existing badge gate. A confirmed badge whose type
includes a child tournament registers for it free (no order, audited as a
comped entry), and cancelling the badge never revokes registrations already
made — the same admission-gate-not-standing-entitlement rule as ADR 0003.
When `badgeRequiredForChildEvents` is set, the gate additionally requires
the badge's admission window to cover the child event's start date.
Deferred, deliberately: owning multiple passes at once, upgrades (day →
VIP; the workaround is cancel-refund and rebuy), and per-type refund
deadlines (`refundDeadline` stays on the convention).

Decided 2026-08-29.
