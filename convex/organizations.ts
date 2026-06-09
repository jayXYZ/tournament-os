import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { validateOrganizationProfileImageDetails } from "../lib/organization-profile-image";
import {
  toInvitationStatus,
  toOrganizerRoleFromWorkosFields,
  type MembershipStatus,
  type OrganizerRole,
} from "../lib/organizer-utils";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { identityWorkosUserId, requireIdentity } from "./auth";
import {
  createWorkosOrganization,
  createWorkosOrganizationMembership,
  sendWorkosInvitation,
  updateWorkosOrganization,
  type WorkosInvitation,
  type WorkosMembership,
} from "./workosApi";
import {
  canInviteMembers,
  canManageOrganizationProfile,
  invitationStatusValidator,
  membershipStatusValidator,
  normalizeEmail,
  normalizeMembershipStatus,
  organizerInviteRoleValidator,
  organizerRoleValidator,
  slugifyOrganizationName,
} from "./validators";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!user) {
      return [];
    }

    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .collect();

    const rows = [];
    for (const membership of memberships) {
      const organization = await ctx.db.get(membership.organizationId);
      if (organization && organization.status === "active") {
        rows.push({
          organization: await organizationWithProfileImageUrl(
            ctx,
            organization,
          ),
          membership,
        });
      }
    }

    return rows;
  },
});

export const getById = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const membership = await requireActiveMembership(ctx, args.organizationId);
    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.status !== "active") {
      throw new Error("Organization not found");
    }

    return {
      organization: await organizationWithProfileImageUrl(ctx, organization),
      membership,
    };
  },
});

export const listMembers = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);
    return await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
  },
});

export const listInvitations = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);
    return await ctx.db
      .query("organizationInvitations")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
  },
});

export const createOrganizerOrganization = action({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<{ organizationId: Id<"organizations"> }> => {
    const identity = await requireIdentity(ctx);
    const name = args.name.trim();
    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }

    const userId: Id<"users"> = await ctx.runMutation(
      internal.users.upsertFromIdentity,
      {
        tokenIdentifier: identity.tokenIdentifier,
        workosUserId: identityWorkosUserId(identity),
        email: identity.email,
        name: identity.name,
        avatarUrl: identity.pictureUrl,
      },
    );

    const workosOrganization = await createWorkosOrganization(name);
    const workosMembership = await createWorkosOrganizationMembership({
      organizationId: workosOrganization.id,
      userId: identityWorkosUserId(identity),
      roleSlug: "owner",
    });

    const organizationId: Id<"organizations"> = await ctx.runMutation(
      internal.organizations.upsertOrganizerMirror,
      {
        createdBy: userId,
        workosOrganizationId: workosOrganization.id,
        name: workosOrganization.name,
        slug: slugifyOrganizationName(workosOrganization.name),
        owner: {
          userId,
          tokenIdentifier: identity.tokenIdentifier,
          workosUserId: identityWorkosUserId(identity),
          email: identity.email,
          workosMembershipId: workosMembership.id,
          role: "owner",
          status: normalizeMembershipStatus(workosMembership.status ?? "active"),
        },
      },
    );

    return { organizationId };
  },
});

export const inviteMember = action({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizerInviteRoleValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ invitationId: Id<"organizationInvitations"> }> => {
    const identity = await requireIdentity(ctx);
    const authorization: {
      organization: Doc<"organizations">;
      membership: Doc<"organizationMemberships">;
      user: Doc<"users">;
    } = await ctx.runQuery(internal.organizations.requireInvitePermission, {
      tokenIdentifier: identity.tokenIdentifier,
      organizationId: args.organizationId,
    });

    const email = normalizeEmail(args.email);
    if (!email.includes("@")) {
      throw new Error("Enter a valid email address");
    }

    const invitation = await sendWorkosInvitation({
      organizationId: authorization.organization.workosOrganizationId,
      email,
      roleSlug: args.role,
      inviterUserId: identityWorkosUserId(identity),
    });

    const invitationId: Id<"organizationInvitations"> = await ctx.runMutation(
      internal.organizations.upsertInvitationMirror,
      {
        organizationId: authorization.organization._id,
        workosOrganizationId: authorization.organization.workosOrganizationId,
        workosInvitationId: invitation.id,
        email,
        role: args.role,
        status: invitationStatus(invitation),
        invitedBy: authorization.user._id,
      },
    );

    return { invitationId };
  },
});

export const generateProfileImageUploadUrl = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireProfilePermission(ctx, args.organizationId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateProfileImage = mutation({
  args: {
    organizationId: v.id("organizations"),
    profileImageStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireProfilePermission(ctx, args.organizationId);

    const metadata = await ctx.db.system.get("_storage", args.profileImageStorageId);
    if (!metadata) {
      throw new Error("Uploaded image was not found");
    }

    const validationMessage = validateOrganizationProfileImageDetails({
      type: metadata.contentType,
      size: metadata.size,
    });
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    await ctx.db.patch(args.organizationId, {
      profileImageStorageId: args.profileImageStorageId,
      updatedAt: Date.now(),
    });

    return { organizationId: args.organizationId };
  },
});

export const updateProfile = action({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{ organizationId: Id<"organizations"> }> => {
    const name = args.name.trim();
    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }

    const identity = await requireIdentity(ctx);
    const authorization: { organization: Doc<"organizations"> } =
      await ctx.runQuery(
        internal.organizations.requireProfilePermissionForAction,
        {
          tokenIdentifier: identity.tokenIdentifier,
          organizationId: args.organizationId,
        },
      );

    const workosOrganization = await updateWorkosOrganization({
      organizationId: authorization.organization.workosOrganizationId,
      name,
    });

    await ctx.runMutation(internal.organizations.updateProfileMirror, {
      organizationId: args.organizationId,
      name: workosOrganization.name,
      slug: slugifyOrganizationName(workosOrganization.name),
    });

    return { organizationId: args.organizationId };
  },
});

export const archiveOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    confirmationName: v.string(),
  },
  handler: async (ctx, args) => {
    const { organization } = await requireProfilePermission(
      ctx,
      args.organizationId,
    );
    if (args.confirmationName.trim() !== organization.name) {
      throw new Error("Type the organization name to archive it");
    }

    await ctx.db.patch(args.organizationId, {
      status: "archived",
      updatedAt: Date.now(),
    });

    return { organizationId: args.organizationId };
  },
});

export const requireInvitePermission = internalQuery({
  args: {
    tokenIdentifier: v.string(),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) {
      throw new Error("Not authenticated");
    }

    const membership = await getActiveMembershipForOrganization(
      ctx,
      args.organizationId,
      user._id,
    );
    if (!membership || !canInviteMembers(membership.role)) {
      throw new Error("Unauthorized");
    }

    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.status !== "active") {
      throw new Error("Organization not found");
    }

    return { organization, membership, user };
  },
});

export const requireProfilePermissionForAction = internalQuery({
  args: {
    tokenIdentifier: v.string(),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) {
      throw new Error("Not authenticated");
    }

    const membership = await getActiveMembershipForOrganization(
      ctx,
      args.organizationId,
      user._id,
    );
    if (!membership || !canManageOrganizationProfile(membership.role)) {
      throw new Error("Unauthorized");
    }

    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.status !== "active") {
      throw new Error("Organization not found");
    }

    return { organization, membership, user };
  },
});

export const upsertOrganizerMirror = internalMutation({
  args: {
    createdBy: v.id("users"),
    workosOrganizationId: v.string(),
    name: v.string(),
    slug: v.string(),
    owner: v.object({
      userId: v.id("users"),
      tokenIdentifier: v.string(),
      workosUserId: v.string(),
      email: v.optional(v.string()),
      workosMembershipId: v.optional(v.string()),
      role: organizerRoleValidator,
      status: membershipStatusValidator,
    }),
  },
  handler: async (ctx, args): Promise<Id<"organizations">> => {
    const now = Date.now();
    const existingOrganization = await ctx.db
      .query("organizations")
      .withIndex("by_workosOrganizationId", (q) =>
        q.eq("workosOrganizationId", args.workosOrganizationId),
      )
      .unique();

    const organizationId =
      existingOrganization?._id ??
      (await ctx.db.insert("organizations", {
        workosOrganizationId: args.workosOrganizationId,
        name: args.name,
        slug: args.slug,
        createdBy: args.createdBy,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }));

    if (existingOrganization) {
      await ctx.db.patch(existingOrganization._id, {
        name: args.name,
        slug: args.slug,
        status: "active",
        updatedAt: now,
      });
    }

    await upsertMembership(ctx, {
      organizationId,
      workosOrganizationId: args.workosOrganizationId,
      workosMembershipId: args.owner.workosMembershipId,
      userId: args.owner.userId,
      tokenIdentifier: args.owner.tokenIdentifier,
      workosUserId: args.owner.workosUserId,
      email: args.owner.email,
      role: args.owner.role,
      status: args.owner.status,
      now,
    });

    return organizationId;
  },
});

export const updateProfileMirror = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.organizationId, {
      name: args.name,
      slug: args.slug,
      updatedAt: Date.now(),
    });

    return args.organizationId;
  },
});

export const upsertInvitationMirror = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    workosOrganizationId: v.string(),
    workosInvitationId: v.string(),
    email: v.string(),
    role: organizerInviteRoleValidator,
    status: invitationStatusValidator,
    invitedBy: v.id("users"),
  },
  handler: async (ctx, args): Promise<Id<"organizationInvitations">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_workosInvitationId", (q) =>
        q.eq("workosInvitationId", args.workosInvitationId),
      )
      .unique();

    const patch = {
      organizationId: args.organizationId,
      workosOrganizationId: args.workosOrganizationId,
      email: args.email,
      role: args.role,
      status: args.status,
      invitedBy: args.invitedBy,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("organizationInvitations", {
      workosInvitationId: args.workosInvitationId,
      ...patch,
      createdAt: now,
    });
  },
});

async function requireActiveMembership(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const membership = await getActiveMembershipForOrganization(
    ctx,
    organizationId,
    user._id,
  );
  if (!membership) {
    throw new Error("Unauthorized");
  }

  return membership;
}

async function getActiveMembershipForOrganization(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_userId_and_status", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("userId", userId)
        .eq("status", "active"),
    )
    .unique();
}

async function upsertMembership(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    workosOrganizationId: string;
    workosMembershipId?: string;
    userId?: Id<"users">;
    tokenIdentifier?: string;
    workosUserId?: string;
    email?: string;
    role: OrganizerRole;
    status: MembershipStatus;
    now: number;
  },
) {
  const existing = args.workosMembershipId
    ? await ctx.db
        .query("organizationMemberships")
        .withIndex("by_workosMembershipId", (q) =>
          q.eq("workosMembershipId", args.workosMembershipId),
        )
        .unique()
    : null;

  const patch = {
    organizationId: args.organizationId,
    workosOrganizationId: args.workosOrganizationId,
    workosMembershipId: args.workosMembershipId,
    userId: args.userId,
    tokenIdentifier: args.tokenIdentifier,
    workosUserId: args.workosUserId,
    email: args.email,
    role: args.role,
    status: args.status,
    updatedAt: args.now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert("organizationMemberships", {
    ...patch,
    createdAt: args.now,
  });
}

function invitationStatus(invitation: WorkosInvitation) {
  return toInvitationStatus(invitation.status ?? invitation.state);
}

export function workosMembershipRole(membership: WorkosMembership): OrganizerRole {
  return toOrganizerRoleFromWorkosFields(membership as Record<string, unknown>);
}

async function organizationWithProfileImageUrl(
  ctx: QueryCtx,
  organization: Doc<"organizations">,
) {
  const profileImageUrl = organization.profileImageStorageId
    ? await ctx.storage.getUrl(organization.profileImageStorageId)
    : null;

  return {
    ...organization,
    profileImageUrl,
  };
}

async function requireProfilePermission(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const membership = await getActiveMembershipForOrganization(
    ctx,
    organizationId,
    user._id,
  );
  if (!membership || !canManageOrganizationProfile(membership.role)) {
    throw new Error("Unauthorized");
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status !== "active") {
    throw new Error("Organization not found");
  }

  return { organization, membership, user };
}
