import { v } from "convex/values";

import {
  invitationStatuses,
  membershipStatuses,
  organizationStatuses,
  organizerInviteRoles,
  organizerRoles,
} from "../lib/organizer-utils";

export {
  canInviteMembers,
  canManageOrganizationProfile,
  normalizeInviteEmail as normalizeEmail,
  slugifyOrganizationName,
  toMembershipStatus as normalizeMembershipStatus,
} from "../lib/organizer-utils";

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

export const tournamentStatusValidator = v.union(
  v.literal("private"),
  v.literal("public"),
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
