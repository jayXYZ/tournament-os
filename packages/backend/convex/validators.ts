import { v } from "convex/values";

import {
  invitationStatuses,
  membershipStatuses,
  organizationStatuses,
  organizerInviteRoles,
  organizerRoles,
} from "@tournament-os/shared/organizer-utils";
import { tournamentFormats } from "@tournament-os/shared/tournament-creation-utils";

export {
  canInviteMembers,
  canManageOrganizationProfile,
  normalizeInviteEmail as normalizeEmail,
  slugifyOrganizationName,
} from "@tournament-os/shared/organizer-utils";

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
// "pending", "waitlisted", and "rejected" are reserved for a planned
// registration-review flow (approval queue, waitlist promotion) and
// currently have no writer — read-side handling already accounts for them.
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

// How a phase cuts the field when it completes: keep only the top N ranked
// players, or everyone at or above a match-point bar. Null means no cut —
// every active player advances. Only configurable on a Swiss phase followed by
// another Swiss phase; a top-8 playoff always applies its own fixed cut.
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

export const tournamentMatchStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("confirmed"),
  v.literal("cancelled"),
);

// Who performed an audited action: an organizer acting on the event, or a
// player acting on their own registration/match.
export const auditActorRoleValidator = v.union(
  v.literal("organizer"),
  v.literal("player"),
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
    type: v.literal("match_result_confirmed"),
    matchId: v.id("tournamentMatches"),
    roundNumber: v.number(),
    tableNumber: v.union(v.number(), v.null()),
  }),
  v.object({
    type: v.literal("player_registered"),
    player: auditPlayerRefValidator,
  }),
  v.object({
    type: v.literal("registration_cancelled"),
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
);

// The tournament's single live round timer. Server-side writes happen only on
// organizer actions; clients derive the ticking countdown (and overtime, which
// is never stored) from these anchors locally. Mirrored structurally by
// RoundTimerState in @tournament-os/shared/timer-utils.
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
