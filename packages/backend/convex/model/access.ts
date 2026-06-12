import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireIdentity } from "../auth";
import {
  canInviteMembers,
  canManageOrganizationProfile,
} from "../validators";
import { userByTokenIdentifier } from "./users";

export async function currentUserOrNull(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  return await userByTokenIdentifier(ctx, identity.tokenIdentifier);
}

export async function requireCurrentUser(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx);
  const user = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}

export async function getActiveMembership(
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

export async function requireActiveMembership(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const user = await requireCurrentUser(ctx);
  const membership = await getActiveMembership(ctx, organizationId, user._id);
  if (!membership) {
    throw new Error("Unauthorized");
  }

  return { user, membership };
}

export async function requireActiveOrganization(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status !== "active") {
    throw new Error("Organization not found");
  }
  return organization;
}

export async function requireProfilePermission(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  if (!canManageOrganizationProfile(membership.role)) {
    throw new Error("Unauthorized");
  }

  const organization = await requireActiveOrganization(ctx, organizationId);
  return { organization, membership, user };
}

export async function requireInvitePermission(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  if (!canInviteMembers(membership.role)) {
    throw new Error("Unauthorized");
  }

  const organization = await requireActiveOrganization(ctx, organizationId);
  return { organization, membership, user };
}
