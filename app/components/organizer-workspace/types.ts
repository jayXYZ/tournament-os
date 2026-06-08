import type { Doc } from "@/convex/_generated/dataModel";
import type {
  InvitationStatus,
  OrganizerInviteRole,
  OrganizerRole,
} from "@/lib/organizer-utils";

export type AdminView = "tournaments" | "staff";
export type BusyState = "org" | "invite" | "tournament" | null;
export type Role = OrganizerInviteRole;
export type MemberRole = OrganizerRole;
export type Tournament = Doc<"tournaments">;

export type OrganizationRow = {
  organization: Doc<"organizations">;
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
