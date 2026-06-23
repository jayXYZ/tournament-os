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

export function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export function toMembershipStatus(status: string): MembershipStatus {
  if (isMembershipStatus(status)) {
    return status;
  }

  return "pending";
}

export function toOrganizerRole(role: unknown): OrganizerRole {
  return organizerRoleValue(role) ?? "staff";
}

export function toInvitationStatus(status: unknown): InvitationStatus {
  if (isInvitationStatus(status)) {
    return status;
  }

  return "pending";
}

export function isOrganizerRole(role: unknown): role is OrganizerRole {
  return organizerRoles.includes(role as OrganizerRole);
}

export function isMembershipStatus(
  status: unknown,
): status is MembershipStatus {
  return membershipStatuses.includes(status as MembershipStatus);
}

export function isInvitationStatus(
  status: unknown,
): status is InvitationStatus {
  return invitationStatuses.includes(status as InvitationStatus);
}

function organizerRoleValue(role: unknown): OrganizerRole | null {
  if (isOrganizerRole(role)) {
    return role;
  }

  if (role && typeof role === "object") {
    const slug = (role as { slug?: unknown }).slug;
    if (isOrganizerRole(slug)) {
      return slug;
    }
  }

  return null;
}
