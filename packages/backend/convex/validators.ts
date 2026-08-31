import { v } from "convex/values";

import {
  invitationStatuses,
  membershipStatuses,
  organizationStatuses,
  organizerInviteRoles,
  organizerRoles,
} from "@paper-pairings/shared/organizer-utils";
import { tournamentFormats } from "@paper-pairings/shared/tournament-creation-utils";

export {
  canInviteMembers,
  canManageOrganizationPayments,
  canManageOrganizationProfile,
  normalizeInviteEmail as normalizeEmail,
  slugifyOrganizationName,
} from "@paper-pairings/shared/organizer-utils";

export const userProfileVisibilityValidator = v.union(
  v.literal("public"),
  v.literal("private"),
);

export const organizerRoleValidator = v.union(
  v.literal(organizerRoles[0]),
  v.literal(organizerRoles[1]),
  v.literal(organizerRoles[2]),
);

export const membershipStatusValidator = v.union(
  v.literal(membershipStatuses[0]),
  v.literal(membershipStatuses[1]),
  v.literal(membershipStatuses[2]),
);

export const organizationStatusValidator = v.union(
  v.literal(organizationStatuses[0]),
  v.literal(organizationStatuses[1]),
);

export const invitationStatusValidator = v.union(
  v.literal(invitationStatuses[0]),
  v.literal(invitationStatuses[1]),
  v.literal(invitationStatuses[2]),
  v.literal(invitationStatuses[3]),
);

export const organizerInviteRoleValidator = v.union(
  v.literal(organizerInviteRoles[0]),
  v.literal(organizerInviteRoles[1]),
);

// Snapshot of a connected account's stripe_balance.stripe_transfers
// capability from the last Stripe retrieve (the Stripe API's own status
// vocabulary). "active" is the only status that allows transferring an
// organization its payouts.
export const stripeTransfersCapabilityStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("restricted"),
  v.literal("unsupported"),
);

export const tournamentFormatValidator = v.union(
  v.literal(tournamentFormats[0]),
  v.literal(tournamentFormats[1]),
  v.literal(tournamentFormats[2]),
  v.literal(tournamentFormats[3]),
  v.literal(tournamentFormats[4]),
  v.literal(tournamentFormats[5]),
  v.literal(tournamentFormats[6]),
  v.literal(tournamentFormats[7]),
);

// Who can see the tournament. Independent of lifecycle: "public" events appear
// in listings, "unlisted" events are reachable by link/code only, and
// "private" events are visible only to organizers and registered players.
export const tournamentVisibilityValidator = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
);

// Where the tournament is in its run. "setup" is pre-publish configuration
// (never publicly viewable regardless of visibility; named to avoid clashing
// with the Magic "draft" format); "registration" means published and open for
// registration.
export const tournamentLifecycleValidator = v.union(
  v.literal("setup"),
  v.literal("registration"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

// Overall admission workflow for an event entry. Only "confirmed" entries
// occupy capacity and become tournament participants; the remaining states
// never contribute to standings or public history.
//
// Every state has its write-side transitions in model/roster.ts: the
// organizer review verbs (approveEntry confirms pending/waitlisted/rejected
// rows, rejectEntry declines applications or removes-and-bars players,
// waitlistEntry holds a pending application) and the player's own withdrawal
// through cancelEntry. "pending" rows are created by registerSelf when the
// tournament's registrationRequiresApproval setting is on; "waitlisted" rows
// only ever come from an organizer parking a pending application.
export const tournamentEntryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("waitlisted"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("rejected"),
);

// Competitive eligibility after an entry is confirmed. "active" means the
// player remains eligible to be paired; it is initialized on confirmation so
// starting round one never needs to patch every registration.
//
// "disqualified" is reserved for a planned DQ feature and currently has no
// writer — read-side handling already accounts for it.
export const tournamentParticipationStatusValidator = v.union(
  v.literal("active"),
  v.literal("dropped"),
  v.literal("eliminated"),
  v.literal("disqualified"),
);

export const tournamentPhaseStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const tournamentPhaseTypeValidator = v.union(
  v.literal("swiss"),
  v.literal("single_elimination"),
);

export const tournamentPhaseRoundModeValidator = v.union(
  v.literal("dynamic"),
  v.literal("fixed"),
);

// A phase's Match Structure: best-of-1, -3, or -5, meaning first to ⌈X/2⌉
// game wins (see CONTEXT.md "Match Structure" and
// @paper-pairings/shared/match-structure for the derived rules).
export const tournamentPhaseBestOfValidator = v.union(
  v.literal(1),
  v.literal(3),
  v.literal(5),
);

// How a phase cuts the field when it completes: keep only the top N ranked
// players, or everyone at or above a match-point bar. Null means no cut —
// every active player advances. Configurable on any phase with a following
// phase, whatever its type; a phase feeding the single-elimination playoff
// defaults to a top-8 cut when the input omits the field, while an explicit
// null keeps no cut (see validPhaseInputs in model/phases.ts).
const topPlayersCutoffValidator = v.object({
  kind: v.literal("top_X_players"),
  playerCount: v.number(),
});
const pointsCutoffValidator = v.object({
  kind: v.literal("X_points_or_more"),
  matchPoints: v.number(),
});

export const tournamentPhaseCutoffValidator = v.union(
  topPlayersCutoffValidator,
  pointsCutoffValidator,
  v.null(),
);

// Lifecycle of a phase's player meeting. Absent on the phase = not started;
// "in_progress" is the only state in which seats are shown to players.
//
// The remaining two states say what the meeting's seat snapshot is worth:
// pairing the phase's first round stamps "completed" (from "in_progress" or
// "superseded") in the same patch that sets the phase "in_progress", and
// rewindLatestRound stamps "superseded" when it un-pairs that round — the
// snapshot outlived the standings it was drawn from, and
// cutoffPartitionForNextPhase reads the stamp to re-draw the cut boundary
// instead of taking the seats verbatim. "completed" therefore always means
// the phase's first round is paired; it can never coexist with an "upcoming"
// phase.
export const playerMeetingStatusValidator = v.union(
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("superseded"),
);

export const tournamentRoundStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

// No "confirmed" status: a Reported Result counts immediately and there is
// no opponent-confirmation step (see CONTEXT.md); disputes resolve through
// organizer override.
export const tournamentMatchStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

// One decklist line: how many copies of a named card. Card names are stored
// as the player submitted them — there is no card database to normalize
// against (yet), so legality checking is a human deck-check concern. Convex
// has no numeric refinement validators, so the submission mutation enforces
// that quantity is a positive integer.
export const decklistCardEntryValidator = v.object({
  name: v.string(),
  quantity: v.number(),
});

// Who performed an audited action: an organizer acting on the event, a
// player acting on their own registration/match, or the system itself —
// payment webhooks and scheduled sweeps that no user performed (these rows
// carry no actorUserId).
export const auditActorRoleValidator = v.union(
  v.literal("organizer"),
  v.literal("player"),
  v.literal("system"),
);

// Payment order lifecycle. "requires_payment" is an order with no open
// Checkout Session (a post-approval order before the player clicks pay, or
// after a session expired); "awaiting_payment" has a live session;
// "canceled" closed unpaid (withdrawal/rejection/start). The money-holding
// states are paid, refunded ("full" refund), partially_refunded (entry-only
// refund kept the fees), and disputed.
export const paymentOrderStatusValidator = v.union(
  v.literal("requires_payment"),
  v.literal("awaiting_payment"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("refunded"),
  v.literal("partially_refunded"),
  v.literal("disputed"),
);

// Why the order exists: a direct paid registration, or the payment an
// organizer approval requested from a pending application.
export const paymentOrderPurposeValidator = v.union(
  v.literal("registration"),
  v.literal("post_approval"),
);

// The amount breakdown snapshotted onto an order at creation (see
// @paper-pairings/shared/payment-fees); never recomputed afterwards.
export const orderAmountBreakdownValidator = v.object({
  entryFeeCents: v.number(),
  platformFeeCents: v.number(),
  processingFeeCents: v.number(),
  totalCents: v.number(),
  currency: v.string(),
});

// "full" returns the whole charge; "entry_only" returns just the entry cost
// (a repeat drop keeps the platform and processing fees).
export const paymentRefundKindValidator = v.union(
  v.literal("full"),
  v.literal("entry_only"),
);

// What triggered the refund. Only "player_cancel" flags the player for the
// repeat-drop fee rule; "seat_unavailable" is the automatic refund when a
// completed payment can no longer seat its player (capacity filled during
// checkout, or the registration closed meanwhile).
export const paymentRefundReasonValidator = v.union(
  v.literal("player_cancel"),
  v.literal("organizer_remove"),
  v.literal("tournament_cancelled"),
  v.literal("seat_unavailable"),
);

export const paymentRefundStatusValidator = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
);

// The tournament payout's lifecycle: enumerating (transfer rows still being
// written by the batched sweep), sending (Stripe transfers in flight),
// completed, failed (a transfer exhausted its retries), or blocked (the
// account is not payouts-ready or refunds are still settling — retriable).
export const tournamentPayoutStatusValidator = v.union(
  v.literal("enumerating"),
  v.literal("sending"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("blocked"),
);

// One order's transfer within a payout. "skipped" is a row whose amount the
// greedy absorbed-fee deduction reduced to zero.
export const payoutTransferStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("skipped"),
  v.literal("failed"),
);

// A player referenced by an audit event. The name is denormalized at write
// time so the log stays readable without per-row joins, even if the roster
// changes later.
const auditPlayerRefValidator = v.object({
  registrationId: v.id("tournamentRegistrations"),
  playerName: v.union(v.string(), v.null()),
});

// One side of a match result as captured in the log.
const auditMatchResultLineValidator = v.object({
  registrationId: v.id("tournamentRegistrations"),
  playerName: v.union(v.string(), v.null()),
  gameWins: v.number(),
  gameLosses: v.number(),
  gameDraws: v.number(),
});

// How a match outcome came about (see CONTEXT.md): a played result, or one
// of the Awarded Result kinds. "played", "bye", and "concession" (a drop
// during the player's own unfinished match) have writers today; forfeit,
// no-show, and DQ land with the judge adjudication actions (TODO.md
// section 5), and walkovers are byes.
export const matchResultKindValidator = v.union(
  v.literal("played"),
  v.literal("bye"),
  v.literal("concession"),
  v.literal("forfeit"),
  v.literal("no_show"),
  v.literal("dq"),
);

// A player's side of a match outcome. Stored explicitly rather than derived
// from game wins so awarded results and double losses stay representable.
export const matchOutcomeValidator = v.union(
  v.literal("win"),
  v.literal("loss"),
  v.literal("draw"),
);

// One player's line of a result revision. Match points are stored alongside
// the outcome they derive from so readers never re-derive scoring rules.
export const matchResultLineValidator = v.object({
  registrationId: v.id("tournamentRegistrations"),
  outcome: matchOutcomeValidator,
  matchPointsEarned: v.number(),
  gameWins: v.number(),
  gameLosses: v.number(),
  gameDraws: v.number(),
});

// What happened, as a discriminated union so the log view renders each kind
// with full type safety. Events carry enough denormalized context (names,
// round/table numbers, prior results) to reconstruct a dispute without
// joining back to rows that may since have changed.
export const tournamentAuditEventValidator = v.union(
  v.object({
    type: v.literal("match_result_recorded"),
    matchId: v.id("tournamentMatches"),
    roundNumber: v.number(),
    tableNumber: v.union(v.number(), v.null()),
    result: v.array(auditMatchResultLineValidator),
    // The result this one replaced, when the match already had one
    // (player-reported or previously recorded) — the "result edit" case.
    previousResult: v.union(v.array(auditMatchResultLineValidator), v.null()),
  }),
  v.object({
    type: v.literal("match_result_reported"),
    matchId: v.id("tournamentMatches"),
    roundNumber: v.number(),
    tableNumber: v.union(v.number(), v.null()),
    result: v.array(auditMatchResultLineValidator),
  }),
  v.object({
    // A drop during the player's own unfinished match: the awarded
    // concession the drop recorded, alongside the player_dropped event the
    // drop itself logs. The actor is whoever recorded the drop — the player
    // themself or an organizer.
    type: v.literal("match_conceded"),
    matchId: v.id("tournamentMatches"),
    roundNumber: v.number(),
    tableNumber: v.union(v.number(), v.null()),
    // The player whose drop conceded the match.
    player: auditPlayerRefValidator,
    result: v.array(auditMatchResultLineValidator),
  }),
  v.object({
    type: v.literal("player_registered"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    // registerSelf under organizer approval: the player filed a "pending"
    // application instead of taking a seat; the review decision that follows
    // gets its own event (registration_approved/rejected/waitlisted).
    type: v.literal("registration_requested"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    type: v.literal("decklist_submitted"),
    player: auditPlayerRefValidator,
    // Card totals only, not the list itself: enough for a dispute timeline
    // ("resubmitted as 61+14 at 7:41pm") without copying the decklist into
    // every log row — the current list is one join away, and what an edit
    // changed is a deck-check conversation, not a log rendering concern.
    maindeckCardCount: v.number(),
    sideboardCardCount: v.number(),
    // False for the first submission, true when it replaced an earlier list —
    // the resubmissions are the rows deck-check disputes care about.
    isUpdate: v.boolean(),
  }),
  v.object({
    type: v.literal("registration_cancelled"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    type: v.literal("registration_approved"),
    player: auditPlayerRefValidator,
    // The admission state the approval lifted the entry out of — an approved
    // application ("pending"), a waitlist promotion ("waitlisted"), or a
    // reversed rejection ("rejected") — so the log tells which decision was
    // made without joining back to the row. Exactly
    // registrationApproveEffect's arms: a confirmed or cancelled row has
    // nothing to approve.
    previousEntryStatus: v.union(
      v.literal("pending"),
      v.literal("waitlisted"),
      v.literal("rejected"),
    ),
  }),
  v.object({
    type: v.literal("registration_rejected"),
    player: auditPlayerRefValidator,
    // What the rejection did: declined an application ("pending"/
    // "waitlisted"), removed a confirmed player and released their seat
    // ("confirmed"), or barred a cancelled row from re-entering
    // ("cancelled"). Never "rejected": rejecting twice is a refused no-op,
    // not a second decision.
    previousEntryStatus: v.union(
      v.literal("pending"),
      v.literal("waitlisted"),
      v.literal("confirmed"),
      v.literal("cancelled"),
    ),
  }),
  v.object({
    type: v.literal("registration_waitlisted"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    type: v.literal("player_dropped"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    type: v.literal("player_reinstated"),
    player: auditPlayerRefValidator,
  }),
  v.object({ type: v.literal("tournament_published") }),
  v.object({
    type: v.literal("player_meeting_started"),
    phaseOrder: v.number(),
    playerCount: v.number(),
  }),
  v.object({ type: v.literal("tournament_started"), playerCount: v.number() }),
  v.object({
    type: v.literal("round_started"),
    roundId: v.id("tournamentRounds"),
    roundNumber: v.number(),
    playerCount: v.number(),
  }),
  v.object({
    type: v.literal("round_completed"),
    roundId: v.id("tournamentRounds"),
    roundNumber: v.number(),
  }),
  v.object({
    type: v.literal("round_rewound"),
    removedRoundId: v.id("tournamentRounds"),
    removedRoundNumber: v.number(),
    reopenedRoundId: v.union(v.id("tournamentRounds"), v.null()),
    reopenedRoundNumber: v.union(v.number(), v.null()),
  }),
  v.object({ type: v.literal("tournament_completed") }),
  v.object({ type: v.literal("tournament_cancelled") }),
  v.object({
    // A player's entry-fee payment completed (fulfilled by webhook). Whether
    // it seated them is the accompanying event: player_registered when it
    // did, refund_issued (seat_unavailable) when the seat was gone.
    type: v.literal("payment_completed"),
    player: auditPlayerRefValidator,
    totalCents: v.number(),
  }),
  v.object({
    type: v.literal("payment_failed"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    // The order's Checkout Session expired unpaid. A direct registration
    // closes with it; a post-approval order stays payable.
    type: v.literal("payment_expired"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    // An organizer approved an application on a paid event: no seat yet —
    // the approval requests payment, and the seat is taken when it lands.
    type: v.literal("payment_requested"),
    player: auditPlayerRefValidator,
    totalCents: v.number(),
  }),
  v.object({
    type: v.literal("refund_issued"),
    player: auditPlayerRefValidator,
    kind: paymentRefundKindValidator,
    reason: paymentRefundReasonValidator,
    amountCents: v.number(),
  }),
  v.object({
    type: v.literal("refund_failed"),
    player: auditPlayerRefValidator,
    amountCents: v.number(),
  }),
  v.object({
    // The completed tournament's entry fees were transferred to the
    // organization (net of organizer-absorbed refund fees).
    type: v.literal("payout_sent"),
    netCents: v.number(),
  }),
  v.object({
    type: v.literal("payout_failed"),
  }),
  v.object({
    // The player's card issuer opened a dispute on their entry payment; the
    // order is excluded from the payout while it stands.
    type: v.literal("order_disputed"),
    player: auditPlayerRefValidator,
  }),
);

// The tournament's single live round timer. Server-side writes happen only on
// organizer actions; clients derive the ticking countdown (and overtime, which
// is never stored) from these anchors locally. Mirrored structurally by
// RoundTimerState in @paper-pairings/shared/timer-utils.
export const tournamentRoundTimerValidator = v.union(
  v.object({
    kind: v.literal("running"),
    roundId: v.id("tournamentRounds"),
    // Epoch ms when remaining time hits zero; clients tick against this.
    endsAt: v.number(),
    // Configured length including adjustments, for "12:34 of 50:00" displays.
    durationMs: v.number(),
    startedAt: v.number(),
  }),
  v.object({
    kind: v.literal("paused"),
    roundId: v.id("tournamentRounds"),
    // Frozen remainder; negative when paused while already in overtime.
    remainingMs: v.number(),
    durationMs: v.number(),
    startedAt: v.number(),
  }),
);
