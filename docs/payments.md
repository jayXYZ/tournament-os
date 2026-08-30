# Payments (Stripe Connect)

Paid event entry, built on Stripe Connect. The invariants below are pinned by
`packages/backend/convex/payments.structure.convex.spec.ts`; the behavioral
suites are `paymentsConnect` / `entryFeeSettings` / `paymentsCheckout` /
`paymentsRefunds` / `paymentsPayouts` / `paymentsSweeps` `.convex.spec.ts`.

## Architecture

- **Connected accounts** — each organization onboards a Stripe **Accounts v2**
  connected account (`dashboard: "express"`, platform-owned fees and losses,
  recipient configuration requesting only `stripe_balance.stripe_transfers`)
  through Stripe-hosted Account Links from the organization page. "Linking an
  existing Stripe account" via OAuth is a deprecated v1 pattern and
  deliberately unsupported. Capability status is snapshotted on the
  onboarding return route and on manual refresh; money movement never trusts
  the snapshot — the payout re-checks the live capability first.
- **Charge pattern** — **separate charges and transfers** (hold-and-release).
  Players pay through a Stripe-hosted Checkout Session on the platform
  account, tagged with the order's transfer group (`order:{orderId}`). No
  funds move to the organization at charge time and no application fee is
  set: fees are transfer math. Entry fees transfer when the tournament
  **completes**, so pre-start refunds are plain `refunds.create` and
  cancelling an event never needs clawbacks.
- **Fee economics** — `@tournament-os/shared/payment-fees`. The organizer is
  paid exactly the entry cost per paid seat; the player additionally absorbs
  the platform fee (`PLATFORM_FEE_PERCENT`, default 5% of entry) and a
  grossed-up estimate of Stripe's processing fee (`STRIPE_FEE_PERCENT` /
  `STRIPE_FEE_FIXED_CENTS`, defaults 2.9 / 30). The gross-up guarantees (a
  tested invariant) that the estimated fee on the total never eats into
  entry + platform fee. Each order snapshots its breakdown at creation;
  config changes never reprice open orders. Variance between the estimate
  and Stripe's actual per-card fee lands on the platform — watch the margin
  reports.
- **State model** — payment state lives on order records, never on
  registration status. "Awaiting payment" is a `pending` entry plus a live
  `paymentOrders` row. Seats are taken exclusively by the webhook, which
  re-checks capacity at payment time and auto-refunds in full when the seat
  is gone. Approval-mode paid events charge **after** approval.
- **Refunds** — a player's first pre-deadline cancel refunds in full, with
  the non-returnable processing estimate deducted from the organizer's
  payout; a repeat cancel (derived from refund records per participant)
  refunds the entry cost only; organizer removals always refund in full
  without flagging the player; past the organizer-set `refundDeadline` a
  cancel refunds nothing and the entry flows into the payout. Cancelling the
  tournament refunds everyone, withheld repeat-drop fees included (no payout
  exists, so the platform absorbs the processing fees). Mid-event drops
  never refund.
- **Payout** — completion schedules a sweep: one transfer per paid order
  (`source_transaction` = the order's charge, per-row idempotency keys),
  greedily reduced by the organizer-absorbed refund fees. Blocked payouts
  (refunds settling, account not payouts-ready) and exhausted-retry failures
  surface on the tournament settings page with an owner-only retry.
- **Webhooks** — single signed endpoint,
  `POST <deployment>.convex.site/stripe/events`. Fulfillment happens only
  here; success pages just watch the order reactively. Every handler is a
  single internalMutation, idempotent via the processed-event table plus
  status guards. Handled events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `refund.updated`, `refund.failed` (executor reconciliation), and
  `charge.dispute.created` (v1 policy: mark the order disputed and exclude
  it from the payout).
- **Guards** — the entry fee freezes once any order exists; hard deletion
  refuses while any player money is unsettled (cancel to refund, or complete
  to pay out, first).

All Stripe I/O funnels through `convex/stripe/client.ts` (fetch HTTP client +
SubtleCrypto webhook verification — no Node runtime), which is also the mock
seam for the specs. Guests cannot pay (self-serve only); test events cannot
charge.

## Deployment setup

One-time Stripe dashboard steps (human-only):

1. Complete the platform profile and acknowledge negative-balance liability
   at [dashboard.stripe.com/settings/connect/platform-profile](https://dashboard.stripe.com/settings/connect/platform-profile);
   confirm Accounts v2 access for the account.
2. Create a [restricted key](https://docs.stripe.com/keys/restricted-api-keys)
   scoped to Connect accounts, Checkout Sessions, PaymentIntents (read),
   Refunds, and Transfers.
3. Register the webhook endpoint
   (`https://<prod-deployment>.convex.site/stripe/events`) for the events
   listed above and note its signing secret.

Then set the Convex env vars (see [environment.md](./environment.md)):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `WEB_APP_ORIGIN`, and
optionally the three fee overrides.

## Local development

- Forward webhooks:
  `stripe listen --forward-to <dev-deployment>.convex.site/stripe/events`,
  then `pnpm --filter @tournament-os/backend exec convex env set STRIPE_WEBHOOK_SECRET <whsec_… from listen>`.
- Pay with [test cards](https://docs.stripe.com/testing) (`4242 4242 4242
4242` succeeds).
- Stripe requires HTTPS for Account Link return/refresh URLs even in test
  mode, so Connect onboarding against a locally served web app needs an
  HTTPS tunnel (or a deployed preview) as `WEB_APP_ORIGIN`.
