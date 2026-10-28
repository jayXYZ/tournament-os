# Event audit policy

The event journal (`tournamentAuditEvents`, `conventionAuditEvents`) records
participation, played and awarded results, lifecycle transitions, explicit
pairings publication, organizer timer changes, and money outcomes. The domain
operation that changes that state appends its event in the same mutation, so
an event can never land without its write or the write without its event.
Failed writes and idempotent no-ops append nothing.

This is an event history for organizers, not an organization security log:

- **Configuration is silent.** Setup, details, phases, visibility,
  auto-publish, ticket types, and invite-link administration change how an
  event is set up, not what happened in it. Invite links are also secrets the
  journal must never copy.
- **Hard deletion leaves no record.** Deleting an event purges its rows and
  its journal together; no deletion record survives anywhere. What protects
  players is the deletion gate, not a tombstone: only a test event or an
  unpublished event with no enrolled players can be deleted
  (`requireTournamentDeletable`), so no real player history is ever purged.
  Every other event is cancelled instead, which keeps its journal. The money
  guard (`requireEventPaymentsSettled`) still covers a test event's
  synthetic payments.
- **One event per operation.** Side effects an operation performs on the
  way are part of its own event rather than separate rows: timer cleanup on
  round completion, rewind, and cancellation; auto-publication at pairing
  time and the publish-on-complete safety net; a mid-round drop's concession
  (logged as `match_conceded` right after `player_dropped`, because it is a
  result); the start/cancel sweep withdrawing pending entries whose order
  never opened Checkout.

Event payloads are defined once, in `tournamentAuditEventValidator` /
`conventionAuditEventValidator` (`packages/backend/convex/validators.ts`).
Player references are built only through `model/auditLog.ts`
(`auditPlayerRef`, `auditPlayerRefForUser`, `auditMatchPlayerRef`), which
stamp the organizer label at append time.

## Tournament entry points

| Module        | Mutations                                                                                                                           | Policy / owner                                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lifecycle     | createTournament, createTournamentWithPhases                                                                                        | Silent draft creation; the journal starts at publication.                                                                                                                                                                                           |
| lifecycle     | updateTournamentSetup, updateTournamentDetails, updateTournamentPhases, updateTournamentVisibility, updatePairingsAutoPublish       | Silent configuration.                                                                                                                                                                                                                               |
| lifecycle     | continueRegistrationStartDateSync                                                                                                   | Silent continuation of a configuration denormalization.                                                                                                                                                                                             |
| lifecycle     | publishTournament, cancelTournament, completeTournament                                                                             | model/progression: `tournament_published`, `tournament_cancelled` (clears the timer, schedules the money sweeps), `tournament_completed` (schedules the payout).                                                                                    |
| lifecycle     | deleteTournament, continueDeleteTournament                                                                                          | Silent purge of operational data and the journal, refused unless the event is a test event or unpublished with no entries, then after the payment-settlement check. The interim cancel-and-hide is part of the purge, not a `tournament_cancelled`. |
| rounds        | startTournament, generateNextRound, completeRound, rewindLatestRound                                                                | model/progression: `tournament_started`, `round_started` (the created round's stored number), `round_completed`, `round_rewound`. Auto-publication and timer cleanup are part of these events.                                                      |
| rounds        | publishPairings                                                                                                                     | model/progression: `pairings_published` with actor and round number, once; publishing already-public pairings appends nothing.                                                                                                                      |
| rounds        | breakPairing, pairPlayers, assignBye                                                                                                | model/manualPairing: `pairing_broken`, `pairing_created`.                                                                                                                                                                                           |
| rounds        | recordMatchResult                                                                                                                   | model/matchResults: `match_result_recorded` with the result it replaced.                                                                                                                                                                            |
| registrations | registerSelf                                                                                                                        | model/roster `registerEntry`: `player_registered` (with `compedByBadge`) or, under approval, `registration_requested`.                                                                                                                              |
| registrations | cancelMyRegistration, dropRegistration, reinstateRegistration                                                                       | model/roster: `registration_cancelled`, `player_dropped` (+ `match_conceded` from model/matchResults mid-round), `player_reinstated` (or `payment_requested` when a paid restore needs a new payment).                                              |
| registrations | approveRegistration, rejectRegistration, waitlistRegistration                                                                       | model/roster review verbs: `registration_approved` (or `payment_requested` on a paid event), `registration_rejected`, `registration_waitlisted`.                                                                                                    |
| player        | reportMyMatchResult, dropSelf                                                                                                       | model/matchResults `match_result_reported`; model/roster `player_dropped` (+ `match_conceded`).                                                                                                                                                     |
| playerMeeting | startPlayerMeeting                                                                                                                  | model/progression: `player_meeting_started`.                                                                                                                                                                                                        |
| decklists     | submitMyDecklist                                                                                                                    | model/decklists `submitDecklist`: `decklist_submitted` with card counts; `isUpdate` marks a resubmission.                                                                                                                                           |
| timer         | setRoundDuration                                                                                                                    | model/timer: `round_duration_changed` with the old and new default, only when the value changes.                                                                                                                                                    |
| timer         | startTimer, pauseTimer, resumeTimer, adjustTimer, clearTimer                                                                        | model/timer: `round_timer_changed` with the operation and the stored timer before and after. Clearing an absent timer appends nothing.                                                                                                              |
| invites       | regenerateInviteLink, disableInviteLink                                                                                             | Silent access-link administration; join secrets never enter the journal.                                                                                                                                                                            |
| testing       | createTestTournament, seedTestPlayers, generateTestRoundResults, advanceTestRound, resetTestTournament, continueResetTestTournament | Synthetic test administration is silent: an auto-started test event is never published or `tournament_started`, and simulated results log nothing. advanceTestRound runs the organizer's `advance` and keeps its events. Reset purges the journal.  |

## Payments entry points (both event kinds)

| Module   | Mutations/actions                                                                                                                                                                                                                       | Policy / owner                                                                                                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| checkout | createEntryCheckout, createBadgeCheckout, beginEntryCheckout, beginBadgeCheckout, attachCheckoutSession, expireAbandonedSession                                                                                                         | Silent attempt/session bookkeeping: these reserve no seat and are not payment outcomes.                                                                                                                                                                                                           |
| connect  | beginStripeOnboarding, recordStripeAccountCreated, beginStripeStatusRefresh, recordStripeAccountStatus, recordStripeAccountStatusByAccountId, beginStripeDashboardLink, createOnboardingLink, createDashboardLink, refreshAccountStatus | Organization-level provider setup; outside any event journal.                                                                                                                                                                                                                                     |
| webhooks | handleCheckoutCompleted, handleCheckoutExpired, handleAsyncPaymentFailed, handleDisputeCreated                                                                                                                                          | `payment_completed` (+ `player_registered`/`badge_registered`, or `refund_issued` when the seat is gone), `payment_expired`, `payment_failed`, `order_disputed`. A direct registration's withdrawn pending entry is part of the expiry/failure line. Duplicate or obsolete deliveries are silent. |
| refunds  | closeOpenOrdersSweep                                                                                                                                                                                                                    | Closes open orders and withdraws the pending entries behind them. Logs `payment_expired` only for an order with a live Checkout session; an order that never opened Checkout closes under the enclosing start/cancel event.                                                                       |
| refunds  | cancelEventPaymentsSweep                                                                                                                                                                                                                | Each refund decision logs `refund_issued` through `queueRefund`, once per refund, never once per batch continuation.                                                                                                                                                                              |
| refunds  | beginRefundExecution, executeRefund                                                                                                                                                                                                     | Silent provider execution/attempt bookkeeping.                                                                                                                                                                                                                                                    |
| refunds  | markRefundResult, handleRefundEvent                                                                                                                                                                                                     | The decision was already logged as `refund_issued`; the shared outcome path logs `refund_failed`. Deduplicated callbacks are silent.                                                                                                                                                              |
| payouts  | startPayoutSweep, sumAbsorbedFeesBatch, enumeratePayoutBatch, beginSendTransfers, takeQueuedTransfers, markTransferResult, sendTransfers                                                                                                | Silent batching/transfer bookkeeping.                                                                                                                                                                                                                                                             |
| payouts  | finalizePayout                                                                                                                                                                                                                          | `payout_sent` / `payout_failed`, in the same transaction as the outcome.                                                                                                                                                                                                                          |
| payouts  | markPayoutBlocked                                                                                                                                                                                                                       | Silent retryable capability block; no transfer outcome has occurred.                                                                                                                                                                                                                              |
| payouts  | retryPayout, beginPayoutRetry                                                                                                                                                                                                           | Silent retry scheduling; the final outcome supplies the journal entry.                                                                                                                                                                                                                            |

## Conventions and everything else

Convention lifecycle (`publishConvention`, `completeConvention`,
`cancelConvention`), the badge roster (`registerSelfForConvention`,
`cancelMyBadge`, `removeBadge`), and child attachment (`attachTournament`,
`detachTournament`, `createTournamentForConvention`) log their
`conventionAuditEvents`: the roster and attachment verbs from
model/conventions, the lifecycle transitions still from their handlers in
`conventions/lifecycle.ts` (the one remaining handler-level write-and-log
site, left for a convention-side pass).
Convention setup, details, visibility, and ticket types are silent
configuration; `deleteConvention` / `continueDeleteConvention` purge like
tournament deletion.

`organizations.ts` and `users.ts` (organization setup, membership invites,
profiles) belong to no event and write no journal.

## Adding a mutating entry point

Add its row here. If it records an event: add the arm to the validator
union, emit it from the model function that owns the write (handlers stay
thin adapters), cover it in a behavioral spec, and handle the arm in the
organizer UI (`audit-event-text.ts`, which the typecheck forces).
