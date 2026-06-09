import type { Doc } from "@/convex/_generated/dataModel";
import type {
  InvitationStatus,
  OrganizerInviteRole,
  OrganizerRole,
} from "@/lib/organizer-utils";

export type AdminView = "tournaments" | "staff" | "organization";
export type BusyState =
  | "org"
  | "invite"
  | "tournament"
  | "profile"
  | "profileImage"
  | "archive"
  | null;
export type Role = OrganizerInviteRole;
export type MemberRole = OrganizerRole;
export type Tournament = Doc<"tournaments">;
export type OrganizationWithProfileImage = Doc<"organizations"> & {
  profileImageUrl: string | null;
};

export type OrganizationRow = {
  organization: OrganizationWithProfileImage;
  membership: Doc<"organizationMemberships">;
};

export type InvitationRow = {
  _id: Doc<"organizationInvitations">["_id"];
  email: string;
  role: MemberRole;
  status: InvitationStatus;
};

export type MemberRow = {
  _id: Doc<"organizationMemberships">["_id"];
  email?: string;
  workosUserId?: string;
  role: MemberRole;
  status: string;
};
