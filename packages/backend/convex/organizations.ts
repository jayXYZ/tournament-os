import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { validateOrganizationProfileImageDetails } from "@tournament-os/core/organization-profile-image";
import { mutation, query } from "./_generated/server";
import {
  currentUserOrNull,
  requireActiveMembership,
  requireActiveOrganization,
  requireInvitePermission,
  requireProfilePermission,
} from "./model/access";
import { ensureCurrentUser } from "./model/users";
import {
  normalizeEmail,
  organizerInviteRoleValidator,
  slugifyOrganizationName,
} from "./validators";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return [];
    }

    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", user._id).eq("status", "active"),
      )
      .take(128);

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
    const { membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const organization = await requireActiveOrganization(
      ctx,
      args.organizationId,
    );

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
    const memberships = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .take(512);

    return memberships.map((membership) => ({
      _id: membership._id,
      _creationTime: membership._creationTime,
      organizationId: membership.organizationId,
      userId: membership.userId,
      email: membership.email,
      role: membership.role,
      status: membership.status,
    }));
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
      .take(512);
  },
});

export const createOrganizerOrganization = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }

    const user = await ensureCurrentUser(ctx);
    const now = Date.now();

    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug: slugifyOrganizationName(name),
      createdBy: user._id,
      status: "active",
      updatedAt: now,
    });

    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId: user._id,
      email: user.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });

    return { organizationId };
  },
});

export const inviteMember = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizerInviteRoleValidator,
  },
  handler: async (ctx, args) => {
    const { organization, user } = await requireInvitePermission(
      ctx,
      args.organizationId,
    );

    const email = normalizeEmail(args.email);
    if (!email.includes("@")) {
      throw new Error("Enter a valid email address");
    }

    const now = Date.now();

    // The invitation activates on the invitee's next sign-in (see
    // acceptPendingInvitations in model/users.ts). Re-inviting the same email
    // refreshes the role on the pending invitation instead of duplicating it.
    const existing = await ctx.db
      .query("organizationInvitations")
      .withIndex("by_organizationId_and_email", (q) =>
        q.eq("organizationId", organization._id).eq("email", email),
      )
      .take(64);
    const pending = existing.find(
      (invitation) => invitation.status === "pending",
    );

    if (pending) {
      await ctx.db.patch(pending._id, {
        role: args.role,
        invitedBy: user._id,
        updatedAt: now,
      });
      return { invitationId: pending._id };
    }

    const invitationId = await ctx.db.insert("organizationInvitations", {
      organizationId: organization._id,
      email,
      role: args.role,
      status: "pending",
      invitedBy: user._id,
      updatedAt: now,
    });

    return { invitationId };
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("organizationInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    await requireInvitePermission(ctx, invitation.organizationId);

    if (invitation.status !== "pending") {
      throw new Error("Only pending invitations can be revoked");
    }

    await ctx.db.patch(invitation._id, {
      status: "revoked",
      updatedAt: Date.now(),
    });

    return { invitationId: invitation._id };
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

export const updateProfile = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }

    await requireProfilePermission(ctx, args.organizationId);

    await ctx.db.patch(args.organizationId, {
      name,
      slug: slugifyOrganizationName(name),
      updatedAt: Date.now(),
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
