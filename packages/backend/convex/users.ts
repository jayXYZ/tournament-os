import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireIdentity } from "./auth";
import { ensureCurrentUser, upsertUser, userByTokenIdentifier } from "./model/users";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  },
});

export const upsertMe = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const user = await ensureCurrentUser(ctx);
    return user._id;
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
    return await upsertUser(ctx, args);
  },
});
