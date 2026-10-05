# Payments (Stripe Connect)

Paid event entry, built on Stripe Connect. Two kinds of event sell entries
through one shared engine: tournaments (entry fees) and conventions (badge
fees). The money tables (`paymentOrders`, `paymentRefunds`, `eventPayouts`,
`payoutTransfers`) carry an exactly-one-of owner pair
(`tournamentId`/`conventionId`) matching `registrationId`'s table;
`model/paidEvents.ts` is the one seam that resolves a row back to its owner,
and the domain rules in `model/payments.ts` are structural over either doc
(the convention document deliberately reuses the tournament paid-event field
names — see ADR 0003). Everything below applies to both kinds unless it says
otherwise. The invariants are pinned by
`packages/backend/convex/payments.structure.convex.spec.ts`; the behavioral
suites are `paymentsConnect` / `entryFeeSettings` / `paymentsCheckout` /
`paymentsRefunds` / `paymentsPayouts` / `paymentsSweeps` /
`conventionPayments` `.convex.spec.ts`.

## Architecture

- **Connected accounts** — each organization onboards a Stripe **Accounts v2**
  connected account (`dashboard: "express"`, platform-owned fees and losses,
  recipient configuration requesting only `stripe_balance.stripe_transfers`)
  through Stripe-hosted Account Links from the organization page. "Linking an
  existing Stripe account" via OAuth is a deprecated v1 pattern and
  deliberately unsupported. Capability status is snapshotted on the
  onboarding return route, on manual refresh, and whenever Stripe pushes a
  connected-account event (see Webhooks); money movement never trusts the
  snapshot — the payout re-checks the live capability first. Organizers
  reach their Express Dashboard (balance, upcoming payouts, bank account)
  through single-use login links minted in-app (`createDashboardLink`),
  the access path Stripe prescribes for `dashboard: "express"`.
- **Supported countries: US only.** Accounts v2 requires `identity.country`
  at creation and never lets it change; Checkout and transfers are USD-only.
  `SUPPORTED_STRIPE_COUNTRIES` (`@paper-pairings/shared/payment-fees`) is
  the one list: the first-connect action refuses any other country before
  calling Stripe (a wrongly-countried account could never finish onboarding
  and the organization owns exactly one account), the payments card states
  the limitation and collects an explicit "based in the United States"
  acknowledgement, and the country is stored on
  `organizationStripeAccounts`. Widening the list is the entry point for
  the cross-border payouts item in `TODO.md` §9; charging players in local
  currencies is a separate, larger item there.
- **Charge pattern** — **separate charges and transfers** (hold-and-release).
  Players pay through a Stripe-hosted Checkout Session on the platform
  account, tagged with the order's transfer group (`order:{orderId}`). No
  funds move to the organization at charge time and no application fee is
  set: fees are transfer math. Entry fees transfer when the tournament
  **completes**, so pre-start refunds are plain `refunds.create` and
  cancelling an event never needs clawbacks.
- **Fee economics** — `@paper-pairings/shared/payment-fees`. The organizer is
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
  greedily reduced by the organizer-absorbed refund fees. One payout per
  event: a tournament's fires from `completeTournament`, a convention's from
  the organizer's explicit `completeConvention` (a convention has no rounds
  to derive completion from); the two settle independently even when the
  tournament is a child of the convention. Blocked payouts (refunds
  settling, account not payouts-ready) and exhausted-retry failures surface
  on the event's settings page with an owner-only retry.
- **Webhooks** — two signed endpoints, one per Stripe event format.
  - Snapshot events: `POST <deployment>.convex.site/stripe/events`.
    Fulfillment happens only here; success pages just watch the order
    reactively. Every handler is a single internalMutation, idempotent via
    the processed-event table plus status guards. Handled events:
    `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
    `checkout.session.async_payment_failed`, `checkout.session.expired`,
    `refund.updated`, `refund.failed` (executor reconciliation), and
    `charge.dispute.created` (v1 policy: mark the order disputed and exclude
    it from the payout).
  - Thin events (v2): `POST <deployment>.convex.site/stripe/account-events`,
    a separate event destination with its own signing secret
    (`STRIPE_ACCOUNT_WEBHOOK_SECRET`). Subscribed to
    `v2.core.account[configuration.recipient].capability_status_updated` and
    `v2.core.account[requirements].updated`; the route re-reads the live
    transfers capability and overwrites the organization's snapshot, so the
    payments card and the entry-fee gate stay current without polling.
    Idempotent by construction (a snapshot overwrite), so no event
    bookkeeping.
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
   with exactly these rows (first column, "this account"; the second
   "connected accounts" column stays None — every call is made on the
   platform account). The Accounts v2 rows are separate from Connect's v1
   "Accounts" row, which does not cover `/v2/core/accounts`
   ([permissions reference](https://docs.stripe.com/keys/permissions-reference)).
   - Accounts v2 → **Accounts v2: Read**, **Recipient Configuration: Write**
     (v2 account create/retrieve and v2 account links)
   - Connect → **Login Links: Write**, **Transfers: Write**
   - Checkout → **Checkout Sessions: Write**
   - Core → **PaymentIntents: Read**, **Charges and Refunds: Write**
     Give it an [access policy](https://docs.stripe.com/keys#access-policies)
     if the deployment's egress is predictable.
3. Register the snapshot webhook endpoint
   (`https://<prod-deployment>.convex.site/stripe/events`) for the snapshot
   events listed above and note its signing secret.
4. Register a second event destination with **thin events** enabled
   (Workbench → Webhooks → Add destination → Advanced → "Use thin events";
   events from **Your account**) at
   `https://<prod-deployment>.convex.site/stripe/account-events` for the
   two `v2.core.account[…]` events listed above, and note its signing
   secret.

Then set the Convex env vars (see [environment.md](./environment.md)):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT_WEBHOOK_SECRET`,
`WEB_APP_ORIGIN`, and optionally the three fee overrides.

Use a [sandbox](https://docs.stripe.com/sandboxes) per environment (local,
CI, preview) rather than the account's shared test mode: sandboxes isolate
settings, keys, and connected accounts from each other and from live mode.

## Local development

- Forward snapshot webhooks:
  `stripe listen --forward-to <dev-deployment>.convex.site/stripe/events`,
  then `pnpm --filter @paper-pairings/backend exec convex env set STRIPE_WEBHOOK_SECRET <whsec_… from listen>`.
- Forward thin account events in a second listener (snapshot and thin events
  cannot share one destination):
  `stripe listen --events 'v2.core.account[configuration.recipient].capability_status_updated,v2.core.account[requirements].updated' --forward-to <dev-deployment>.convex.site/stripe/account-events`.
  The CLI uses one signing secret for every listener on the account, so set
  `STRIPE_ACCOUNT_WEBHOOK_SECRET` to the same value as
  `STRIPE_WEBHOOK_SECRET` (`stripe listen --print-secret` prints it without
  starting a listener). Without this listener, status still refreshes on
  onboarding return and the card's refresh button.
- Pay with [test cards](https://docs.stripe.com/testing) (`4242 4242 4242
4242` succeeds).
- Stripe requires HTTPS for Account Link return/refresh URLs even in test
  mode, so Connect onboarding against a locally served web app needs an
  HTTPS tunnel (or a deployed preview) as `WEB_APP_ORIGIN`.
