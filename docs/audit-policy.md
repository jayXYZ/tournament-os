# Event audit policy

The event journal records participation, played results, lifecycle transitions,
explicit pairings publication, organizer timer changes, and money outcomes.
The domain operation that changes that state also appends its event in the
same mutation. Failed writes and idempotent no-ops append nothing.

This is an event history, not an organization security log. Configuration and
entry-link administration are deliberately silent. Hard deletion purges the
event and its journal; no surviving deletion record is promised. Automatic
timer cleanup and auto-publication during round creation are represented by
the enclosing lifecycle event, rather than duplicate timer/publication rows.

## Tournament entry points

| Module        | Mutations                                                                                                                           | Policy / owner                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| lifecycle     | createTournament, createTournamentWithPhases                                                                                        | Silent draft creation.                                                                                                           |
| lifecycle     | updateTournamentSetup, updateTournamentDetails, updateTournamentPhases, updateTournamentVisibility, updatePairingsAutoPublish       | Silent configuration; these are not competitive transitions.                                                                     |
| lifecycle     | continueRegistrationStartDateSync                                                                                                   | Silent continuation of configuration denormalization.                                                                            |
| lifecycle     | publishTournament, cancelTournament, completeTournament                                                                             | Logged by model/progression. Cancellation includes timer cleanup and schedules money settlement.                                 |
| lifecycle     | deleteTournament, continueDeleteTournament                                                                                          | Purge operational data and journal after payment-settlement checks.                                                              |
| rounds        | startTournament, generateNextRound, completeRound, rewindLatestRound                                                                | Logged by model/progression; automatic pairings publication and timer cleanup are part of these transitions.                     |
| rounds        | publishPairings                                                                                                                     | model/progression records explicit publication once, with actor and round number.                                                |
| rounds        | breakPairing, pairPlayers, assignBye                                                                                                | Logged by model/manualPairing.                                                                                                   |
| rounds        | recordMatchResult                                                                                                                   | Logged by model/matchResults with before/after results.                                                                          |
| registrations | registerSelf                                                                                                                        | Logged by model/roster as admission or application.                                                                              |
| registrations | cancelMyRegistration, dropRegistration, approveRegistration, rejectRegistration, waitlistRegistration, reinstateRegistration        | Logged by model/roster; a mid-round concession is additionally logged by model/matchResults.                                     |
| player        | reportMyMatchResult, dropSelf                                                                                                       | Logged by model/matchResults or model/roster.                                                                                    |
| playerMeeting | startPlayerMeeting                                                                                                                  | Logged by model/progression.                                                                                                     |
| decklists     | submitMyDecklist                                                                                                                    | Logged by model/decklists, including resubmission counts.                                                                        |
| timer         | setRoundDuration                                                                                                                    | model/timer logs actual default-duration changes.                                                                                |
| timer         | startTimer, pauseTimer, resumeTimer, adjustTimer, clearTimer                                                                        | model/timer logs the operation and before/after timer anchors. Clearing an absent timer is silent.                               |
| invites       | regenerateInviteLink, disableInviteLink                                                                                             | Silent access-link administration; never copy join secrets into the journal.                                                     |
| testing       | createTestTournament, seedTestPlayers, generateTestRoundResults, advanceTestRound, resetTestTournament, continueResetTestTournament | Synthetic test administration is silent; delegated competitive transitions retain their normal events. Reset purges the journal. |

## Payments entry points (both event kinds)

| Module   | Mutations/actions                                                                                                                                  | Policy / owner                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| checkout | createEntryCheckout, createBadgeCheckout, beginEntryCheckout, beginBadgeCheckout, attachCheckoutSession, expireAbandonedSession                    | Silent attempt/session bookkeeping. These reserve no paid seat and are not payment outcomes.                                      |
| connect  | beginStripeOnboarding, recordStripeAccountCreated, beginStripeStatusRefresh, recordStripeAccountStatus, createOnboardingLink, refreshAccountStatus | Organization-level provider setup; outside an event journal.                                                                      |
| webhooks | handleCheckoutCompleted, handleCheckoutExpired, handleAsyncPaymentFailed, handleDisputeCreated                                                     | Owning transactional reconciliation logs payment completion/expiry/failure/dispute. Duplicate or obsolete callbacks are silent.   |
| refunds  | closeOpenOrdersSweep, cancelEventPaymentsSweep                                                                                                     | The owning exit/cancellation is logged; refund decisions log through queueRefund, not once per continuation.                      |
| refunds  | beginRefundExecution, executeRefund                                                                                                                | Silent provider execution/attempt bookkeeping.                                                                                    |
| refunds  | markRefundResult, handleRefundEvent                                                                                                                | The queued decision is already logged as refund_issued; shared reconciliation logs failure; deduplicated callbacks remain silent. |
| payouts  | startPayoutSweep, sumAbsorbedFeesBatch, enumeratePayoutBatch, beginSendTransfers, takeQueuedTransfers, markTransferResult, sendTransfers           | Silent batching/transfer bookkeeping; one event-level outcome is logged at finalization.                                          |
| payouts  | finalizePayout                                                                                                                                     | Log payout sent/failed in the same transaction as the outcome.                                                                    |
| payouts  | markPayoutBlocked                                                                                                                                  | Silent retryable capability block; no transfer outcome has occurred.                                                              |
| payouts  | retryPayout, beginPayoutRetry                                                                                                                      | Silent retry scheduling; the final outcome supplies the journal entry.                                                            |

Convention lifecycle, badge roster, and child attachment operations retain
their existing domain events. Convention setup, ticket-type configuration,
and deletion follow the same silent-configuration/purge policy above.

When adding a mutating entry point, update this inventory and add a behavioral
test for any new recorded event. Event payloads belong in validators.ts; the
UI must handle every arm of the union.
