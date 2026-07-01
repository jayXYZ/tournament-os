import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireIdentity } from "../auth";
import { nextPublicCode } from "./publicCodes";
import { normalizeEmail } from "../validators";

export const USER_PUBLIC_CODE_COUNTER_KEY = "userPublicCode";
// Player codes are purely cosmetic and namespaced by their own route/table, so
// they start at 1 (no offset to hide the user count).
export const FIRST_USER_PUBLIC_CODE = 1;

export async function nextUserPublicCode(ctx: MutationCtx, now = Date.now()) {
  return await nextPublicCode(
    ctx,
    USER_PUBLIC_CODE_COUNTER_KEY,
    FIRST_USER_PUBLIC_CODE,
    now,
  );
}

export type UserIdentityFields = {
  tokenIdentifier: string;
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
    email: fields.email,
    name: fields.name,
    avatarUrl: fields.avatarUrl,
    updatedAt: now,
  };

  const userId = existing
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("users", {
        tokenIdentifier: fields.tokenIdentifier,
        publicCode: await nextUserPublicCode(ctx, now),
        profileVisibility: "public",
        ...patch,
      });

  await acceptPendingInvitations(ctx, {
    userId,
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

// Invitations are keyed by email. When a user signs in (or refreshes their
// profile) we activate any memberships they were invited to.
async function acceptPendingInvitations(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    email?: string;
    now: number;
  },
) {
  if (!args.email) {
    return;
  }

  const email = normalizeEmail(args.email);
  const pending = await ctx.db
    .query("organizationInvitations")
    .withIndex("by_email_and_status", (q) =>
      q.eq("email", email).eq("status", "pending"),
    )
    .take(64);

  for (const invitation of pending) {
    const existing = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_userId", (q) =>
        q
          .eq("organizationId", invitation.organizationId)
          .eq("userId", args.userId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: invitation.role,
        status: "active",
        email,
        updatedAt: args.now,
      });
    } else {
      await ctx.db.insert("organizationMemberships", {
        organizationId: invitation.organizationId,
        userId: args.userId,
        email,
        role: invitation.role,
        status: "active",
        updatedAt: args.now,
      });
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
      updatedAt: args.now,
    });
  }
}
