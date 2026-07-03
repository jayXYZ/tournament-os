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
