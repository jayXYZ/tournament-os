import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./auth";
import { parsePublicCode } from "./model/publicCodes";
import { ensureCurrentUser, userByTokenIdentifier } from "./model/users";

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

// Resolves a player's public code (from a profile URL) to the fields that are
// safe to show publicly. Takes the code as a string because it arrives from the
// URL; unknown or malformed codes return null instead of throwing. Email and the
// Convex id are intentionally omitted.
export const getPublicPlayer = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const publicCode = parsePublicCode(args.publicCode);
    if (publicCode === null) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
      .unique();
    // A missing visibility (legacy/test rows) is treated as public; only an
    // explicit "private" hides the profile. Unknown and private codes both
    // return null so callers can't distinguish them.
    if (!user || user.profileVisibility === "private") {
      return null;
    }

    return {
      publicCode: user.publicCode,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
    };
  },
});
