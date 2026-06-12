import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { identityWorkosUserId, requireIdentity } from "../auth";

export type UserIdentityFields = {
  tokenIdentifier: string;
  workosUserId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
};

export async function userByTokenIdentifier(
  ctx: QueryCtx,
  tokenIdentifier: string,
) {
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .unique();
}

export async function upsertUser(
  ctx: MutationCtx,
  fields: UserIdentityFields,
): Promise<Id<"users">> {
  const now = Date.now();
  const existing = await userByTokenIdentifier(ctx, fields.tokenIdentifier);
  const patch = {
    workosUserId: fields.workosUserId,
    email: fields.email,
    name: fields.name,
    avatarUrl: fields.avatarUrl,
    updatedAt: now,
  };

  const userId = existing
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("users", {
        tokenIdentifier: fields.tokenIdentifier,
        ...patch,
      });

  await linkMembershipsToUser(ctx, {
    userId,
    tokenIdentifier: fields.tokenIdentifier,
    workosUserId: fields.workosUserId,
    email: fields.email,
    now,
  });

  return userId;
}

export async function ensureCurrentUser(
  ctx: MutationCtx,
): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  const userId = await upsertUser(ctx, {
    tokenIdentifier: identity.tokenIdentifier,
    workosUserId: identityWorkosUserId(identity),
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.pictureUrl,
  });
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

async function linkMembershipsToUser(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    tokenIdentifier: string;
    workosUserId: string;
    email?: string;
    now: number;
  },
) {
  const membershipsByWorkosUser = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_workosUserId", (q) =>
      q.eq("workosUserId", args.workosUserId),
    )
    .take(128);

  for (const membership of membershipsByWorkosUser) {
    await ctx.db.patch(membership._id, {
      userId: args.userId,
      tokenIdentifier: args.tokenIdentifier,
      email: args.email ?? membership.email,
      updatedAt: args.now,
    });
  }
}
