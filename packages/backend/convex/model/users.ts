import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireIdentity } from "../auth";
import { claimGuestParticipants } from "./participants";
import { nextPublicCode } from "./publicCodes";
import {
  registrationNameStamp,
  syncRegistrationNameStamps,
} from "./registrations";
import { normalizeEmail, presentText } from "../validators";

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

// How many accounts an email lookup reads: two, so a duplicate is seen
// rather than silently resolved.
const ACCOUNTS_PER_EMAIL_BOUND = 2;

// The account holding a verified email, by its normalized form (the stored
// spelling — see upsertUser). Stored emails are a cache refreshed only when
// their account signs in, so the provider's one-account-per-email rule does
// not carry over on its own: upsertUser releases an address from every
// other row when an account signs in holding it (releaseEmailFromOtherUsers).
// Should two rows still share one, the owner is ambiguous and this returns
// null rather than guess — a caller handing out a registration must not give
// it to whoever held the address first.
export async function userByEmail(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const holders = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .take(ACCOUNTS_PER_EMAIL_BOUND);
  return holders.length === 1 ? holders[0] : null;
}

// Stale holders of one address released per sign-in. Each sign-in releases
// every other holder, so more than one stale row is already unusual.
const RELEASED_EMAIL_HOLDERS_BOUND = 8;

// An account signing in with a verified email owns it now, so any other row
// still carrying it holds a stale copy: its account moved to another address
// at the provider without signing in here since. Clearing it keeps by_email
// a point lookup for userByEmail, and re-stamps that account's registrations
// so their organizer label stops showing the released address. The released
// account picks up its current email at its own next sign-in.
async function releaseEmailFromOtherUsers(
  ctx: MutationCtx,
  args: { userId: Id<"users">; email: string; now: number },
) {
  const holders = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", args.email))
    .take(RELEASED_EMAIL_HOLDERS_BOUND);
  for (const holder of holders) {
    if (holder._id === args.userId) {
      continue;
    }
    await ctx.db.patch(holder._id, { email: undefined, updatedAt: args.now });
    await syncRegistrationNameStamps(
      ctx,
      holder._id,
      registrationNameStamp({ name: holder.name }),
      args.now,
    );
  }
}

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
  identity: UserIdentityFields,
): Promise<Id<"users">> {
  const now = Date.now();
  // Blank provider strings are stored as absent (presentText), so every
  // reader's name-then-email fallback — and the re-stamp comparison below —
  // sees an account with a "" name as nameless.
  // The email is stored normalized (trimmed, lowercased): it is the key
  // invitations, guest claims, and organizer enrollment by email all match
  // on, and by_email lookups need the one canonical spelling.
  const email = presentText(identity.email);
  const fields = {
    ...identity,
    name: presentText(identity.name),
    email: email === undefined ? undefined : normalizeEmail(email),
  };
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
        // Visibility fields are set only on insert: the sign-in patch above
        // must never touch them or it would clobber saved privacy settings.
        profileVisibility: "public",
        historyVisibility: "public",
        ...patch,
      });
  // This patch is the only writer of users.name and users.email, so it is
  // where the name stamps denormalized onto the account's registrations,
  // badges, and standings rows are kept true (see registrationNameStamp):
  // a provider that starts supplying a name, or drops one, reaches every
  // roster and the player standings on the next sign-in. Compared before
  // the patch so an unchanged sign-in — the common case — writes nothing
  // beyond the user row.
  // Every sign-in, not only an email change: one bounded index read, and a
  // row left holding a stale copy is released by the address's next owner
  // whenever they next sign in.
  if (fields.email !== undefined) {
    await releaseEmailFromOtherUsers(ctx, {
      userId,
      email: fields.email,
      now,
    });
  }
  if (
    existing &&
    (existing.name !== fields.name || existing.email !== fields.email)
  ) {
    await syncRegistrationNameStamps(
      ctx,
      userId,
      registrationNameStamp(fields),
      now,
    );
  }

  await acceptPendingInvitations(ctx, {
    userId,
    email: fields.email,
    now,
  });
  // Same sign-in trigger as invitations: guest participants whose contact
  // email matches this verified email merge into the account holder's
  // participant (CONTEXT.md "Claim", ADR 0002).
  await claimGuestParticipants(ctx, {
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
