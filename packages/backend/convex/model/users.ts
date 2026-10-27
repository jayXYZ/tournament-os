import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireIdentity } from "../auth";
import { userError } from "./errors";
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
// a point lookup for userByEmail. The released account's registrations are
// untouched: an account's rows are labelled by its name, never its email,
// and it picks up its current email at its own next sign-in.
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

// The refusal a first sign-in gets when the identity carries no usable name.
// Written for the user: the provider's own sign-up asks for a name, so this
// is reached only by an account that slipped through without one.
export const ACCOUNT_NAME_REQUIRED =
  "Your account has no name. Add a name to your profile, then sign in again.";

export async function upsertUser(
  ctx: MutationCtx,
  identity: UserIdentityFields,
): Promise<Id<"users">> {
  const now = Date.now();
  // Blank provider strings count as absent (presentText). The email is
  // stored normalized (trimmed, lowercased): it is the key invitations,
  // guest claims, and organizer enrollment by email all match on, and
  // by_email lookups need the one canonical spelling.
  const rawEmail = presentText(identity.email);
  const email = rawEmail === undefined ? undefined : normalizeEmail(rawEmail);
  const existing = await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  // An account always has a name (schema users.name). A sign-in carrying
  // one stores it; a sign-in without one keeps the stored name, so a
  // provider that stops supplying the claim never strips a player's name
  // off their rosters and standings; and a first sign-in without one is
  // refused rather than filed nameless.
  const name = presentText(identity.name) ?? existing?.name;
  if (name === undefined) {
    throw userError(ACCOUNT_NAME_REQUIRED);
  }
  const patch = {
    email,
    name,
    avatarUrl: identity.avatarUrl,
    updatedAt: now,
  };

  const userId = existing
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: await nextUserPublicCode(ctx, now),
        // Visibility fields are set only on insert: the sign-in patch above
        // must never touch them or it would clobber saved privacy settings.
        profileVisibility: "public",
        historyVisibility: "public",
        ...patch,
      });
  // Every sign-in, not only an email change: one bounded index read, and a
  // row left holding a stale copy is released by the address's next owner
  // whenever they next sign in.
  if (email !== undefined) {
    await releaseEmailFromOtherUsers(ctx, { userId, email, now });
  }
  // This patch is the only writer of users.name, so it is where the name
  // stamps denormalized onto the account's registrations, badges, and
  // standings rows are kept true (see registrationNameStamp): a renamed
  // account reaches every roster and the player standings on its next
  // sign-in. Compared before the patch so an unchanged sign-in — the common
  // case — writes nothing beyond the user row.
  if (existing && existing.name !== name) {
    await syncRegistrationNameStamps(
      ctx,
      userId,
      registrationNameStamp({ name }),
      now,
    );
  }

  await acceptPendingInvitations(ctx, {
    userId,
    email,
    now,
  });
  // Same sign-in trigger as invitations: guest participants whose contact
  // email matches this verified email merge into the account holder's
  // participant (CONTEXT.md "Claim", ADR 0002).
  await claimGuestParticipants(ctx, {
    userId,
    email,
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
