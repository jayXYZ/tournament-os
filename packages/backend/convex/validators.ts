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

export const tournamentRegistrationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("eliminated"),
  v.literal("dropped"),
  v.literal("disqualified"),
);

export const tournamentPhaseStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const tournamentPhaseRoundModeValidator = v.union(
  v.literal("dynamic"),
  v.literal("fixed"),
);

export const tournamentPhaseCutoffValidator = v.union(
  v.literal("top_X_players"),
  v.literal("X_points_or_more"),
  v.null(),
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
