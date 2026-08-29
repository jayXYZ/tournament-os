export const organizerRoles = ["owner", "admin", "staff"] as const;
export type OrganizerRole = (typeof organizerRoles)[number];

export const organizerInviteRoles = ["admin", "staff"] as const;
export type OrganizerInviteRole = (typeof organizerInviteRoles)[number];

export const membershipStatuses = ["active", "inactive", "pending"] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

export const organizationStatuses = ["active", "archived"] as const;
export type OrganizationStatus = (typeof organizationStatuses)[number];

export const invitationStatuses = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

export function slugifyOrganizationName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "organizer";
}

export function canInviteMembers(role: OrganizerRole) {
  return role === "owner" || role === "admin";
}

export function canManageOrganizationProfile(role: OrganizerRole) {
  return role === "owner" || role === "admin";
}

// Connecting and managing the organization's Stripe account controls where
// event money lands, so it is owner-only rather than sharing the
// owner-or-admin profile rule.
export function canManageOrganizationPayments(role: OrganizerRole) {
  return role === "owner";
}

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}
