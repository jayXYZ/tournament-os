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
