import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  auditActorRoleValidator,
  invitationStatusValidator,
  matchResultKindValidator,
  matchResultLineValidator,
  orderAmountBreakdownValidator,
  paymentOrderPurposeValidator,
  paymentOrderStatusValidator,
  paymentRefundKindValidator,
  paymentRefundReasonValidator,
  paymentRefundStatusValidator,
  payoutTransferStatusValidator,
  tournamentPayoutStatusValidator,
  tournamentPhaseBestOfValidator,
  membershipStatusValidator,
  organizationStatusValidator,
  organizerRoleValidator,
  stripeTransfersCapabilityStatusValidator,
  tournamentFormatValidator,
  tournamentVisibilityValidator,
  tournamentLifecycleValidator,
  tournamentEntryStatusValidator,
  tournamentParticipationStatusValidator,
  tournamentPhaseStatusValidator,
  tournamentPhaseTypeValidator,
  tournamentPhaseRoundModeValidator,
  tournamentPhaseCutoffValidator,
  playerMeetingStatusValidator,
  decklistCardEntryValidator,
  tournamentAuditEventValidator,
  tournamentRoundStatusValidator,
  tournamentRoundTimerValidator,
  tournamentMatchStatusValidator,
  userProfileVisibilityValidator,
} from "./validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    // Human-facing, URL-safe player identifier so profile URLs never expose the
    // Convex document id. Allocated from a counter at creation (see
    // model/users.ts); mirrors the tournament publicCode pattern.
    publicCode: v.number(),
    // Whether the public profile page (users/$publicCode) is visible to anyone.
    // Optional: readers treat a missing value as "public" (see getPublicPlayer),
    // and upsertUser sets it explicitly for new users.
    profileVisibility: v.optional(userProfileVisibilityValidator),
    // Whether the profile page shows past tournament results. Lets a player
    // keep their profile card visible while hiding their history. Optional with
    // the same missing-means-"public" reading as profileVisibility.
    historyVisibility: v.optional(userProfileVisibilityValidator),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_publicCode", ["publicCode"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    profileImageStorageId: v.optional(v.id("_storage")),
    createdBy: v.id("users"),
    status: organizationStatusValidator,
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  organizationMemberships: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    email: v.optional(v.string()),
    role: organizerRoleValidator,
    status: membershipStatusValidator,
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_userId", ["organizationId", "userId"])
    .index("by_organizationId_and_userId_and_status", [
      "organizationId",
      "userId",
      "status",
    ])
    .index("by_userId_and_status", ["userId", "status"]),

  organizationInvitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizerRoleValidator,
    status: invitationStatusValidator,
    invitedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_email_and_status", ["email", "status"])
    .index("by_organizationId_and_email", ["organizationId", "email"]),

  // One row per organization that has started Stripe Connect onboarding: the
  // connected account identity plus a capability snapshot from the last
  // retrieve. Kept off the organization document because every organizer
  // surface subscribes to that doc, while this row changes on sync cadence
  // and is read only by payment surfaces. Money movement never trusts the
  // snapshot — the payout action re-checks the live capability first.
  organizationStripeAccounts: defineTable({
    organizationId: v.id("organizations"),
    stripeAccountId: v.string(),
    transfersCapabilityStatus: stripeTransfersCapabilityStatusValidator,
    // Denormalized transfersCapabilityStatus === "active" so guards and UI
    // read one boolean.
    payoutsReady: v.boolean(),
    lastSyncedAt: v.number(),
    createdBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_stripeAccountId", ["stripeAccountId"]),

  // One row per entry-fee payment attempt chain (TODO.md §9: order, payment,
  // and refund records separate from registration status). The registration
  // stays "pending" while an order is live — the joined order is what
  // disambiguates "awaiting review" from "awaiting payment" — and the
  // Checkout webhook is the only thing that seats a paid player. The
  // amountBreakdown is snapshotted at creation and never recomputed. The
  // Stripe transfer_group is derived (`order:{_id}`, model/payments.ts), not
  // stored.
  paymentOrders: defineTable({
    tournamentId: v.id("tournaments"),
    organizationId: v.id("organizations"),
    registrationId: v.id("tournamentRegistrations"),
    participantId: v.id("participants"),
    // The paying account. Paid registration is self-serve only, so unlike
    // registrations an order always has a user.
    userId: v.id("users"),
    purpose: paymentOrderPurposeValidator,
    amountBreakdown: orderAmountBreakdownValidator,
    status: paymentOrderStatusValidator,
    // Monotonic checkout-attempt counter, bumped by beginEntryCheckout. It is
    // the Stripe idempotency scope (each begin mints a distinct session even
    // when two begins share a wall-clock millisecond) and the attach
    // compare-and-set token (a stale action can never attach over a newer
    // attempt's session).
    checkoutAttempt: v.optional(v.number()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    // source_transaction for the payout transfer (phase E).
    stripeChargeId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_registrationId", ["registrationId"])
    .index("by_tournamentId_and_status", ["tournamentId", "status"])
    // Dispute webhooks arrive keyed by charge, not by order metadata.
    .index("by_stripeChargeId", ["stripeChargeId"]),

  // Refund records for paymentOrders rows. absorbedFeeCents is the
  // organizer-payout deduction the refund caused (the non-returnable
  // processing-fee estimate on organizer-attributable full refunds; 0 for
  // entry-only and seat-unavailable refunds) — the payout sweep sums it, so
  // there is no separate ledger to drift.
  paymentRefunds: defineTable({
    orderId: v.id("paymentOrders"),
    tournamentId: v.id("tournaments"),
    registrationId: v.id("tournamentRegistrations"),
    participantId: v.id("participants"),
    kind: paymentRefundKindValidator,
    reason: paymentRefundReasonValidator,
    amountCents: v.number(),
    absorbedFeeCents: v.number(),
    // Set only when the refund targets a charge other than the order's
    // recorded one (a payment that landed on a superseded checkout session).
    // Such a refund returns stray money and never drives the order's status.
    stripeChargeId: v.optional(v.string()),
    stripeRefundId: v.optional(v.string()),
    status: paymentRefundStatusValidator,
    // Absent for system-initiated refunds (webhook races, sweeps).
    initiatedByUserId: v.optional(v.id("users")),
    updatedAt: v.number(),
  })
    .index("by_orderId", ["orderId"])
    .index("by_tournamentId_and_participantId", [
      "tournamentId",
      "participantId",
    ])
    .index("by_tournamentId_and_status", ["tournamentId", "status"])
    .index("by_stripeRefundId", ["stripeRefundId"]),

  // One row per completed paid tournament: the payout of its entry fees to
  // the organization, created by the sweep completeTournament schedules
  // (payments/payouts.ts). netCents = totalEntryCents − absorbedFeeCents;
  // remainingDeductionCents is the greedy-deduction carry the batched
  // enumeration spends across transfer rows.
  tournamentPayouts: defineTable({
    tournamentId: v.id("tournaments"),
    organizationId: v.id("organizations"),
    // Destination snapshot at sweep start; the send action re-checks the
    // live capability before transferring.
    stripeAccountId: v.string(),
    status: tournamentPayoutStatusValidator,
    totalEntryCents: v.number(),
    absorbedFeeCents: v.number(),
    netCents: v.number(),
    remainingDeductionCents: v.number(),
    // Pagination cursor for the batched enumeration over paid orders (they
    // stay "paid" while transfer rows are written, so a plain take() would
    // re-read the same page forever).
    enumerationCursor: v.optional(v.string()),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_tournamentId", ["tournamentId"]),

  // One transfer per paid order within a payout, anchored to the order's
  // charge via source_transaction so availability follows the original
  // payment. amountCents is the entry fee minus this row's share of the
  // absorbed-fee deduction.
  payoutTransfers: defineTable({
    payoutId: v.id("tournamentPayouts"),
    tournamentId: v.id("tournaments"),
    orderId: v.id("paymentOrders"),
    stripeChargeId: v.string(),
    amountCents: v.number(),
    status: payoutTransferStatusValidator,
    stripeTransferId: v.optional(v.string()),
    attemptCount: v.number(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_payoutId_and_status", ["payoutId", "status"])
    .index("by_orderId", ["orderId"]),

  // Processed Stripe webhook event ids. Every webhook internalMutation
  // checks-then-inserts here first and performs its whole state change in
  // the same transaction, so redelivered events are exact no-ops.
  stripeWebhookEvents: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    processedAt: v.number(),
  }).index("by_stripeEventId", ["stripeEventId"]),

  tournaments: defineTable({
    name: v.string(),
    publicCode: v.number(),
    organizationId: v.id("organizations"),
    createdBy: v.id("users"),
    // Visibility (who can see it) and lifecycle (where it is in its run) are
    // independent axes; see validators.ts for the semantics of each value.
    visibility: tournamentVisibilityValidator,
    lifecycle: tournamentLifecycleValidator,
    startDate: v.number(),
    playerCapacity: v.number(),
    format: tournamentFormatValidator,
    isTestEvent: v.boolean(),
    // When enabled, newly generated rounds are immediately visible on player
    // surfaces. Disabled by default so organizers can review pairings first.
    autoPublishPairings: v.boolean(),
    // Whether this event collects decklists: submission is open to players
    // while registration is, and the decklist surfaces (player editor,
    // organizer deck-check) exist at all. Toggleable pre-start via
    // updateTournamentSetup — turning it off keeps already-submitted lists
    // stored but freezes them.
    decklistRequired: v.boolean(),
    // When enabled, registerSelf files a "pending" application instead of a
    // confirmed seat, and an organizer decides it through the entry-review
    // verbs (approve/reject/waitlist — see model/roster.ts). Toggleable
    // pre-start via updateTournamentSetup; turning it off admits new
    // registrations directly but leaves already-filed applications awaiting
    // review.
    registrationRequiresApproval: v.boolean(),
    // Entry fee in integer USD cents; absent means the event is free and the
    // whole paid-registration flow keys off its presence. Setting it requires
    // the organization's Stripe account to be payouts-ready, and it freezes
    // once any payment order exists (see model/payments.ts). Per paid player
    // the organizer is paid out exactly this amount; the player additionally
    // absorbs the platform fee and estimated processing fee
    // (@tournament-os/shared/payment-fees).
    entryFeeCents: v.optional(v.number()),
    // Optional organizer-set cutoff (epoch ms, at or before startDate) after
    // which a player cancellation no longer triggers the automatic full
    // refund. Absent means refunds run until the tournament starts. Only
    // meaningful — and only settable — while entryFeeCents is set.
    refundDeadline: v.optional(v.number()),
    // Organizer-authored event details (description, prizes, logistics) as
    // markdown, rendered on the public tournament page. Absent means the
    // organizer has not written any.
    detailsMarkdown: v.optional(v.string()),
    // Confirmed entries occupy capacity and remain part of the historical
    // field even after a later competitive drop or elimination.
    confirmedRegistrationCount: v.number(),
    // Deterministic seed for pairing's within-bracket shuffle, so pairings are
    // reproducible and auditable. Optional for rows created before it existed;
    // readers fall back to publicCode.
    seed: v.optional(v.number()),
    // Live timer for the current round; absent = no timer running. Lives here
    // rather than on the round because only one timer can be live per
    // tournament and every surface already subscribes to this doc. Cleared
    // when its round completes.
    roundTimer: v.optional(tournamentRoundTimerValidator),
    // Organizer default round length in ms, pre-filling the timer start
    // control. Absent means the app default (see timer-utils).
    roundDurationMs: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_publicCode", ["publicCode"])
    .index("by_visibility_and_lifecycle_and_startDate", [
      "visibility",
      "lifecycle",
      "startDate",
    ])
    .index("by_organizationId_and_lifecycle_and_startDate", [
      "organizationId",
      "lifecycle",
      "startDate",
    ]),

  appCounters: defineTable({
    key: v.string(),
    nextValue: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // The durable competitor identity registrations belong to (CONTEXT.md
  // "Participant"): at most one linked user account per participant, exactly
  // one participant per account (created lazily at first need), and a
  // participant without one is a Guest. Conduct history and favorites anchor
  // here as they land, so identity survives individual registrations.
  participants: defineTable({
    // The linked account; absent for Guests. See ADR 0002 for how a Guest is
    // claimed into an account holder's participant at sign-in.
    userId: v.optional(v.id("users")),
    // Guest fields: the organizer-provided display name shown wherever the
    // guest plays, and the normalized contact email that keys claiming (and
    // later invitations). A user-linked participant reads name and avatar
    // through its user instead and leaves both unset.
    displayName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_contactEmail", ["contactEmail"]),

  // The tournament's shared join code (see CONTEXT.md "Invite Link"). Its own
  // table rather than a tournament field because tournament documents are
  // returned verbatim to players and public viewers, and the code is a bearer
  // secret: anyone holding it can view and register for a private event. At
  // most one row per tournament — the management mutations upsert through
  // by_tournamentId, so rotating the code rewrites the row and every
  // previously shared link dies with it.
  tournamentInvites: defineTable({
    tournamentId: v.id("tournaments"),
    // Normalized join code; model/invites.ts owns the alphabet and the
    // normalization rule that maps user-typed lookalikes onto it.
    code: v.string(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_code", ["code"]),

  tournamentRegistrations: defineTable({
    tournamentId: v.id("tournaments"),
    participantId: v.id("participants"),
    // Denormalized from the tournament so a player's history can be indexed
    // and paginated newest-first without joining every registration first.
    tournamentStartDate: v.number(),
    entryStatus: tournamentEntryStatusValidator,
    // Present only for confirmed entries. Mutations centralize transitions so
    // non-confirmed entries never carry a competitive state.
    participationStatus: v.optional(tournamentParticipationStatusValidator),
    // Set only when tournament progression changes an active player to
    // "eliminated". Rewinding that round can then restore exactly those
    // players without reviving voluntary drops or disqualifications.
    eliminatedByRoundId: v.optional(v.id("tournamentRounds")),
    // Display name (user.name ?? user.email) denormalized at registration time
    // so roster, standings, and pairings list queries never join through to the
    // user document per row. Optional only for rows written before this field
    // existed; readers fall back to a live user lookup when it is missing.
    playerName: v.optional(v.string()),
    // Denormalized from the player's decklist at submission time (see
    // submitMyDecklist, the only writer of both) so the organizer roster
    // shows who has submitted — and which deck — without a per-row decklist
    // join. decklistId is present iff the registration has a submitted list;
    // deckName mirrors the list's optional name, so "has a decklist" must
    // key off decklistId — an unnamed list has no deckName here either.
    decklistId: v.optional(v.id("tournamentDecklists")),
    deckName: v.optional(v.string()),
    createdAt: v.number(),
    // The player's fixed random tiebreaker for this tournament, breaking
    // otherwise-perfect standings ties. Derived at registration time from
    // the tournament seed and the user's stable publicCode (see
    // model/random.ts) so it is reproducible across reseeds and never
    // correlates with registration order.
    tiebreakRandom: v.number(),
    updatedAt: v.number(),
  })
    // Whole-tournament scans prefix-query this on tournamentId alone; the
    // startDate column exists so a reschedule's sync batches can range-read
    // only rows whose denormalized copy is stale (see
    // syncRegistrationStartDatesBatch).
    .index("by_tournamentId_and_tournamentStartDate", [
      "tournamentId",
      "tournamentStartDate",
    ])
    .index("by_tournamentId_and_participantId", [
      "tournamentId",
      "participantId",
    ])
    .index("by_tournamentId_and_entryStatus_and_participationStatus", [
      "tournamentId",
      "entryStatus",
      "participationStatus",
    ])
    .index("by_participantId_and_entryStatus_and_tournamentStartDate", [
      "participantId",
      "entryStatus",
      "tournamentStartDate",
    ])
    // Organizer roster search over the denormalized name. tournamentId as a
    // filter field scopes matches to one event, so searching never requires
    // loading that event's registration history.
    .searchIndex("search_playerName", {
      searchField: "playerName",
      filterFields: ["tournamentId"],
    }),

  // One decklist per registration, submitted by the player for the event.
  // The parsed maindeck/sideboard entries are the canonical form — legality
  // checks, organizer deck-check views, and any later metagame analytics read
  // structured fields instead of re-parsing text at every call site.
  //
  // The boards are embedded arrays rather than a child cards table: unlike
  // the unbounded lists the schema guidelines warn about, a decklist is
  // small and bounded (tournament decks run ~75 cards across at most a few
  // hundred distinct names, far under the 8192-element / 1MB document
  // limits) and is always read and written as one unit, so a child table
  // would only add per-card reads and multi-document writes.
  //
  // Deliberately no lock/status field: whether a list is still editable
  // derives from the tournament lifecycle (editable during "registration",
  // frozen once play starts), so storing it would just be a second copy that
  // could disagree.
  tournamentDecklists: defineTable({
    tournamentId: v.id("tournaments"),
    // The owning registration. Uniqueness (one list per registration) is
    // enforced by the submission mutation upserting through
    // by_registrationId; re-registering after a cancel reuses the same
    // registration row, so the player's list survives the round trip.
    registrationId: v.id("tournamentRegistrations"),
    // Deliberately no playerName copy: the deck-check surface opens a list
    // from a roster row that already carries the live registration.playerName,
    // and a snapshot taken at submission time would go stale across the
    // cancel → rename → re-register path that keeps this row alive.
    // Player-facing label for the deck (e.g. "Boros Burn"). Absent when the
    // player didn't name it.
    deckName: v.optional(v.string()),
    maindeck: v.array(decklistCardEntryValidator),
    // Constructed sideboards are 0–15 cards; for limited (sealed/draft) this
    // holds the rest of the pool. Size rules are per-format submission-time
    // validation, not schema shape.
    sideboard: v.array(decklistCardEntryValidator),
    // The submission exactly as the player typed or pasted it (ordering,
    // set codes, comments), so the editor round-trips their input and
    // disputes can reference the original text. Absent when the list was
    // built structurally rather than from text.
    rawText: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_registrationId", ["registrationId"])
    .index("by_tournamentId", ["tournamentId"]),

  tournamentPhases: defineTable({
    tournamentId: v.id("tournaments"),
    phaseName: v.optional(v.string()),
    phaseType: tournamentPhaseTypeValidator,
    phaseOrder: v.number(),
    phaseStatus: tournamentPhaseStatusValidator,
    phaseRoundMode: tournamentPhaseRoundModeValidator,
    // The phase's Match Structure (best-of-1/3/5). Drives result-entry
    // validation and the bye scoreline; editable pre-start like the rest of
    // the phase configuration.
    bestOf: tournamentPhaseBestOfValidator,
    phaseTotalRounds: v.union(v.number(), v.null()),
    phaseCurrentRound: v.optional(v.id("tournamentRounds")),
    phaseCutoff: tournamentPhaseCutoffValidator,
    // When set, the final round power-pairs (orders brackets by tiebreakers)
    // instead of random-within-bracket. Optional; readers default to true.
    powerPairFinalRound: v.optional(v.boolean()),
    // When set, the organizer holds a seated player meeting (attendance,
    // announcements) before this phase's first round is paired. Optional;
    // readers default to false. Only decides whether the start-meeting step is
    // offered — playerMeetingStatus alone says whether a meeting is live.
    playerMeeting: v.optional(v.boolean()),
    playerMeetingStatus: v.optional(playerMeetingStatusValidator),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_phaseOrder", ["tournamentId", "phaseOrder"]),

  // One row per player seated at a phase's player meeting, snapshotted when
  // the meeting starts. Rows are immutable and never deleted on drop — readers
  // live-join registration status to strike dropped players. Players who
  // register after the snapshot simply have no row.
  playerMeetingSeats: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    registrationId: v.id("tournamentRegistrations"),
    // Denormalized at snapshot time so the seating list renders without joins.
    playerName: v.union(v.string(), v.null()),
    tableNumber: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentPhaseId_and_tableNumber", [
      "tournamentPhaseId",
      "tableNumber",
    ])
    .index("by_tournamentPhaseId_and_registrationId", [
      "tournamentPhaseId",
      "registrationId",
    ]),

  tournamentRounds: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    roundNumber: v.number(),
    roundName: v.string(),
    roundStatus: tournamentRoundStatusValidator,
    // Absent while generated pairings are organizer-only. Setting this makes
    // the round visible to players through their subscribed queries.
    pairingsPublishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_tournamentPhaseId", ["tournamentPhaseId"])
    .index("by_tournamentPhaseId_and_roundNumber", [
      "tournamentPhaseId",
      "roundNumber",
    ]),

  tournamentMatches: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    tournamentRoundId: v.id("tournamentRounds"),
    // Byes have no table assignment; in the round index they sort before
    // numbered matches because undefined orders first.
    tableNumber: v.optional(v.number()),
    // Single elimination only: the match's 1-based seat-pair position within
    // its bracket round, byes included. The next round is paired from seat
    // winners in this order, which the table index cannot supply — byes have
    // no table, so it hoists them out of their bracket position.
    bracketSeat: v.optional(v.number()),
    matchStatus: tournamentMatchStatusValidator,
    // Set when a player self-reports the result; absent once an organizer
    // records or overrides it. "completed" + this field = unconfirmed report.
    reportedByRegistrationId: v.optional(v.id("tournamentRegistrations")),
    // The revision that is the match's current result; absent while the
    // match has none. Older revisions for the match are superseded history.
    currentResultRevisionId: v.optional(v.id("matchResultRevisions")),
    // The current revision's kind, denormalized so round-level guards (the
    // rewind "untouched round" check) can tell entered results from
    // automatic ones without reading every revision. Written together with
    // currentResultRevisionId, absent exactly when it is.
    currentResultKind: v.optional(matchResultKindValidator),
    updatedAt: v.number(),
  })
    .index("by_tournamentRoundId", ["tournamentRoundId"])
    .index("by_tournamentRoundId_and_tableNumber", [
      "tournamentRoundId",
      "tableNumber",
    ]),

  // Append-only history of every result a match has carried, one row per
  // entry or override — the adjudication record behind the denormalized
  // current-result fields on tournamentMatchPlayers, which stay the hot read
  // model for standings and pairings. Rows are immutable (no updatedAt;
  // _creationTime is the entry timestamp) and are deleted only when their
  // match is deleted (a rewind un-pairing the round, or tournament deletion).
  matchResultRevisions: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentMatchId: v.id("tournamentMatches"),
    kind: matchResultKindValidator,
    // One line per player: two for played results, one for byes.
    lines: v.array(matchResultLineValidator),
    // Who entered the result. Absent for system-written revisions: byes at
    // pairing time and seeded test simulation.
    actorUserId: v.optional(v.id("users")),
    actorRole: v.optional(auditActorRoleValidator),
    // Optional organizer note explaining a correction, for dispute context
    // beyond what the audit log records.
    note: v.optional(v.string()),
  }).index("by_tournamentMatchId", ["tournamentMatchId"]),

  tournamentMatchPlayers: defineTable({
    tournamentMatchId: v.id("tournamentMatches"),
    playerId: v.id("tournamentRegistrations"),
    // Denormalized from the registration at pairing time so the pairings list
    // query renders names without a per-row user join. Optional for legacy rows.
    playerName: v.optional(v.string()),
    opponentPlayerId: v.optional(v.id("tournamentRegistrations")),
    matchPointsEarned: v.optional(v.number()),
    gameWins: v.optional(v.number()),
    gameLosses: v.optional(v.number()),
    // Drawn games are shared by both players, so a match's two rows always
    // carry the same value. Absent (like the fields above) until a result is
    // recorded.
    gameDraws: v.optional(v.number()),
    isBye: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_tournamentMatchId_and_playerId", [
      "tournamentMatchId",
      "playerId",
    ])
    .index("by_playerId", ["playerId"]),

  roundStandings: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    tournamentRoundId: v.id("tournamentRounds"),
    playerId: v.id("tournamentRegistrations"),
    // Denormalized from the registration when the standings row is written, so
    // the standings list query renders names without a per-row user join.
    // Optional for legacy rows; readers fall back to a live user lookup.
    playerName: v.optional(v.string()),
    rank: v.number(),
    matchPoints: v.number(),
    matchWins: v.number(),
    matchLosses: v.number(),
    matchDraws: v.number(),
    // Cumulative totals through this round, denormalized so the next round's
    // standings and pairings never re-read full match history. Optional only
    // for rows written before these fields existed; readers fall back to a
    // per-player history walk when they are missing. byeCount and
    // byeGameWins exist so the percentages a player feeds into opponents'
    // tiebreakers can exclude their byes (see model/standings.ts).
    gameWins: v.optional(v.number()),
    gameLosses: v.optional(v.number()),
    gameDraws: v.optional(v.number()),
    opponentIds: v.optional(v.array(v.id("tournamentRegistrations"))),
    byeCount: v.optional(v.number()),
    byeGameWins: v.optional(v.number()),
    opponentMatchWinPct: v.number(),
    gameWinPct: v.number(),
    opponentGameWinPct: v.number(),
    // Swiss standings use "not_started". Once single elimination begins,
    // this snapshots whether the player is still advancing, was eliminated
    // in a played round, or missed the playoff cut.
    playoffStatus: v.union(
      v.literal("not_started"),
      v.literal("active"),
      v.literal("eliminated"),
      v.literal("cut"),
    ),
    eliminatedInRoundNumber: v.optional(v.number()),
    // The player's live participation status, denormalized so the standings
    // query every player in the event subscribes to never reads a registration
    // document (see getLatestStandings). Absent means "active" — the common
    // case, and what a legacy row without the field must read as. Written when
    // the row is created and written through by the participation module
    // (model/participation.ts) whenever the status changes afterwards, so the
    // copy on the tournament's latest completed round is always the live value.
    participationStatus: v.optional(tournamentParticipationStatusValidator),
    sortKey: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentRoundId_and_playerId", [
      "tournamentRoundId",
      "playerId",
    ])
    .index("by_tournamentRoundId_and_rank", ["tournamentRoundId", "rank"])
    // Ordered descending, this finds a player's row in the tournament's latest
    // completed round in one read: rows are only ever created in
    // round-completion batches, so their newest row is that round's.
    .index("by_playerId", ["playerId"]),

  // Append-only audit trail of tournament actions (result entries and edits,
  // drops, lifecycle changes) for dispute resolution. Rows are immutable — no
  // updatedAt; _creationTime is the event timestamp. Deleted only when the
  // whole tournament is deleted.
  tournamentAuditEvents: defineTable({
    tournamentId: v.id("tournaments"),
    // Absent exactly when actorRole is "system" (payment webhooks and
    // scheduled sweeps have no acting user).
    actorUserId: v.optional(v.id("users")),
    // Denormalized at write time so the log renders without per-row user
    // joins and reflects the actor's name as of the action.
    actorName: v.union(v.string(), v.null()),
    actorRole: auditActorRoleValidator,
    event: tournamentAuditEventValidator,
  }).index("by_tournamentId", ["tournamentId"]),

  tournamentTestConfigs: defineTable({
    tournamentId: v.id("tournaments"),
    dummyPlayerCount: v.number(),
    roundsToGenerate: v.number(),
    seed: v.number(),
    updatedAt: v.number(),
  }).index("by_tournamentId", ["tournamentId"]),

  // Seeded dummy players are Guest participants (no user account), so test
  // events exercise the same identity paths a real guest enrollment will.
  testTournamentPlayers: defineTable({
    tournamentId: v.id("tournaments"),
    participantId: v.id("participants"),
    playerNumber: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_playerNumber", [
      "tournamentId",
      "playerNumber",
    ]),
});
