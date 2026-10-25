# Refund execution and recovery

How a queued refund reaches Stripe, what the system guarantees when it cannot
tell whether it did, and what the platform operator does about a refund that
stays unresolved. Code: `packages/backend/convex/payments/refunds.ts`; the
tests that pin it are `paymentsRefunds.convex.spec.ts`.

## The contract

A refund is a `paymentRefunds` row queued by whatever decided it (a player
cancel, an organizer removal, the cancellation sweep, a stray-charge webhook).
Its lifecycle is `pending` → `succeeded` | `failed` | `needs_attention`.

- **One bounded execution.** The queueing mutation schedules `executeRefund`
  once. The action makes a single `refunds.create` call under the row's
  idempotency key (`refund:<row id>`) with the row id stamped into the
  refund's `metadata.refundId`. A thrown call that is not a definitive
  rejection is recorded and retried a minute later under the same key, up to
  `MAX_REFUND_ATTEMPTS` (5) calls in all. A replay under one key can only
  return the refund an earlier call created, never a second one.
- **`failed` means proof.** A row settles `failed` only when Stripe refused
  the row's _first_ request outright (`stripe/errors.ts`: invalid request,
  card error, idempotency error — the request reached Stripe and created
  nothing), or when Stripe itself reports the refund it holds as failed or
  canceled. A failed refund returned nothing: its order stays `paid` and
  flows into the payout as before.
- **Unknown means parked.** Whenever the outcome cannot be established the
  row moves to `needs_attention`, keeps its attempt count and a diagnostic
  in `lastError`, and gets one `refund_stalled` audit line. This happens
  when:
  - the attempt budget runs out on retriable failures (connection drops,
    5xx, rate limits, authentication or permission errors);
  - Stripe rejects a retry after an earlier attempt already failed
    uncertainly (the rejection proves nothing about the earlier request —
    it may be refusing precisely because that request refunded the charge);
  - the execution died before any recording mutation ran (a crash before or
    around the Stripe call), which the guard scheduled beside every
    execution detects once the execution's scheduler record shows it ended;
  - the execution would start more than six hours after the row was queued
    (`REFUND_CREATE_WINDOW_MS`), since Stripe keeps idempotency keys for at
    least 24 hours and a replay past that would be a fresh request;
  - the order has no charge id after an attempt was already sent.
- **Parked is final for automation.** Nothing reschedules the executor,
  resets the attempt count, or rotates the key. A parked row blocks the
  event's payout (`startPayoutSweep`) and its hard deletion
  (`requireEventPaymentsSettled`).
- **Only Stripe's record settles a parked row**, through the executor's own
  result write (`markRefundResult` → `applyRefundOutcome`):
  - the `refund.updated` / `refund.failed` webhook, matched by Stripe refund
    id or by `metadata.refundId`;
  - the owner's **Check refund status** button on the payout card
    (`checkRefundStatus`), which lists the charge's refunds and takes the
    one stamped with the row id. Checks are metered per caller
    (`checkRefundStatus` in [rate-limiting.md](./rate-limiting.md)); a
    caller over budget is refused before the row is read or Stripe asked.
    Either path applies `succeeded` (order marked refunded / partially
    refunded, absorbed-fee accounting unchanged), `failed` (one
    `refund_failed` audit line, Stripe's failure reason as `lastError`), or
    `pending` / `requires_action` (row back to `pending` with the Stripe id,
    for the webhook to finish). Both paths accept only a refund on the row's
    charge (the order's, or the row's own for a stray-charge refund) for the
    row's exact amount: a refund that names the row but is on another charge
    or for another amount settles nothing, so a wrongly stamped refund cannot
    settle a row. And once a row holds a Stripe refund id, both paths accept
    only that refund: a second refund stamped with the row (a replacement
    issued while the original was still on Stripe's books, say) neither
    replaces it nor settles the row, whatever either refund's status. The
    webhook ignores such a refund and the check reports it as a `conflict`.
    Settled rows are never regressed; a later success report for the row's
    own refund may still recover a `failed` row.
- **A pending row with a Stripe id waits.** Once Stripe has accepted a
  refund for the row, the executor sends nothing more for it; the webhook or
  a status check carries its status. Such a row stays on the payout card,
  with its check button, until it settles — the check is the only way to
  finish it if the final webhook never arrives. A thrown call whose
  recording lands after the webhook has already bound the refund it created
  counts for nothing: no attempt, no retry, no parking. The row stays as
  Stripe's record put it.
- **Every unsettled row is reachable from the card.** The payout card keeps
  two lists, the parked rows and the processing rows, and pages each on its
  own (`listRefundsNeedingAttention`, one status per page request), so a
  mass stall never hides a later row behind rows the owner cannot settle:
  a processing refund queued after a hundred parked ones is on the first
  page of its own list. Pending rows the executor has not sent yet are on
  neither list; they are the executor's and its guard's.

The status check reports one of: `settled` (succeeded or failed),
`processing`, `unresolved` (Stripe holds no refund stamped with the row),
`mismatch` (a stamped refund with a different amount), `conflict` (a stamped
refund other than the one the row already holds), or `check_failed` (the
lookup itself failed). The last four leave the row exactly as it was.
Every result describes the row as stored after the check: a webhook that
settled the row while the check's lookup was in flight wins over the
lookup's older snapshot, including when that lookup found nothing, found a
mismatched refund, or failed — the check re-reads the row once before
reporting any of those. A `conflict` is decided inside the write's own
transaction, so a refund the webhook bound to the row during the lookup is
the one the row keeps.

What this does **not** promise: that every parked refund resolves on its
own, or that the payments system as a whole is exactly-once. Confirmed
`processing` still depends on the webhook (or another check) to finish, and
`unresolved` needs a person.

## Runbook: an unresolved refund

For a row that stays `needs_attention` after **Check refund status** reports
`unresolved`, `mismatch`, or `conflict`, or keeps reporting `check_failed`;
likewise for a processing row the check reports a `conflict` on. Do not mark
the row failed to unblock the payout — a parked row may already have been
paid, and `failed` would pay the order out on top of it.

1. **Identify the case.** From the row (Convex dashboard, `paymentRefunds`):
   its `_id` (the reference the organizer sees), `orderId`, owning
   `tournamentId` / `conventionId`, `amountCents` (USD), `attemptCount`,
   `lastError`, `_creationTime`, `updatedAt`; from the order, the
   `stripeChargeId` (or the row's own `stripeChargeId` for a stray-charge
   refund). The deployment's function logs for `executeRefund` around
   `_creationTime` carry the thrown errors and, when the Stripe client
   surfaced them, Stripe request ids.
2. **Confirm nothing local is still running.** `_scheduled_functions` in the
   dashboard should show no pending `executeRefund` or
   `guardRefundExecution` for the row id. If one is pending, wait for it;
   cancelling a scheduled function does not undo a request it already sent.
3. **Inspect Stripe.** In the Stripe dashboard (or `stripe refunds list
--charge <chargeId>` with the Stripe CLI, logged in to the matching
   account and mode), list every refund on the charge. Cross-check the
   request log for the window around `_creationTime` and any request ids
   from step 1.
4. **A matching refund exists** (right charge, right amount and currency,
   right live/test mode, `metadata.refundId` equal to the row id): run
   **Check refund status** again — it settles from that refund. If the
   refund is on the charge but lacks the stamp, see step 7 before attaching
   one. Never attach an unrelated refund to make the payout proceed.
5. **The outcome is still unknown** (the request log shows a request with no
   recorded response, or Stripe's answer is unclear): contact Stripe support
   with the request id and charge id, and keep the row parked. The payout
   and deletion stay blocked until the answer arrives.
6. **Arranging a replacement** is only for the case where steps 3–5 have
   established that the original request did not create a refund and is no
   longer unresolved. Issue the replacement against the same charge for the
   row's exact `amountCents`, and stamp it with the row id at creation
   (`metadata.refundId`).
7. **Connecting a verified refund to the row.** Stripe allows metadata
   updates on refunds (`stripe refunds update <re_id> -d
"metadata[refundId]=<row id>"`, or the dashboard's metadata editor). Only
   stamp a refund that matches the row's charge, amount, currency and mode,
   and only when it is the one refund that could be the row's. A row that
   already holds a Stripe refund id accepts no other: a second stamped
   refund is reported as `conflict` and never settles the row. If the charge
   already carries a stamped refund that failed, or more than one candidate
   refund, do not overwrite or add a stamp: escalate for case-specific
   accounting instead. Once stamped, run **Check refund status**; the
   webhook for the metadata update may settle the row first.
8. **Record the case**: operator, the evidence from steps 3–5, the Stripe
   refund and request ids, and the resolution, in the support record for
   the event. There is no shortcut that marks a row failed to unblock money.
9. **Finish**: confirm the row is `succeeded` or `failed` and the order
   status moved accordingly, then retry the payout from the payout card.
   A `failed` outcome keeps the existing business treatment (the order pays
   out; the player's claim is a support matter outside this system).

Refunds Stripe reports as `processing` need no operator action; they settle
by webhook, and they stay on the payout card so the owner can check them at
any time.
