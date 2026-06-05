import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireIdentity, identityWorkosUserId } from "./auth";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
  },
});

export const upsertMe = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const workosUserId = identityWorkosUserId(identity);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    const patch = {
      workosUserId,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.pictureUrl,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      await linkMembershipsToUser(ctx, {
        userId: existing._id,
        tokenIdentifier: identity.tokenIdentifier,
        workosUserId,
        email: identity.email,
        now,
      });
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      ...patch,
      createdAt: now,
    });

    await linkMembershipsToUser(ctx, {
      userId,
      tokenIdentifier: identity.tokenIdentifier,
      workosUserId,
      email: identity.email,
      now,
    });

    return userId;
  },
});

export const upsertFromIdentity = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    workosUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();

    const patch = {
      workosUserId: args.workosUserId,
      email: args.email,
      name: args.name,
      avatarUrl: args.avatarUrl,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      await linkMembershipsToUser(ctx, {
        userId: existing._id,
        tokenIdentifier: args.tokenIdentifier,
        workosUserId: args.workosUserId,
        email: args.email,
        now,
      });
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: args.tokenIdentifier,
      ...patch,
      createdAt: now,
    });

    await linkMembershipsToUser(ctx, {
      userId,
      tokenIdentifier: args.tokenIdentifier,
      workosUserId: args.workosUserId,
      email: args.email,
      now,
    });

    return userId;
  },
});

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
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", args.workosUserId))
    .collect();

  for (const membership of membershipsByWorkosUser) {
    await ctx.db.patch(membership._id, {
      userId: args.userId,
      tokenIdentifier: args.tokenIdentifier,
      email: args.email ?? membership.email,
      updatedAt: args.now,
    });
  }
}
