import type { MutationCtx } from "../_generated/server";
import { mintUniqueCode, normalizeCode } from "./codes";

// Public codes are the human-facing, URL-safe identifiers that keep Convex
// document ids out of URLs. Two kinds live here, in different tables and
// routes, so collisions across them are irrelevant:
//
// - Events (tournaments and conventions) carry a random code (CONTEXT.md
//   "Public Code"). It is the only way to reach an unlisted event, so it must
//   not be guessable from its neighbours the way a counter would be.
// - Users carry a counter-allocated number (see model/users.ts). Profile
//   URLs and each player's tiebreakRandom key on it.

// 6 characters × 5 bits = 30 bits, short enough to read aloud or type from a
// poster. Random codes stop anyone counting from one event to the next, but
// they don't hide an unlisted event from random guessing: with N unlisted
// events a guess hits one about once in 2^30 / N tries, and these lookups are
// queries, which can't be rate-limited. Never a secret, then (CONTEXT.md
// "Public Code"); private visibility is the protection. Fixed apart from the
// 10-character invite code so /join/<code> can tell the two apart.
export const PUBLIC_CODE_LENGTH = 6;

// Mints an event public code no row in `table` holds. Both tables index the
// code as by_publicCode, and the lookups that resolve a URL use unique() on
// it, so the check is what keeps those lookups sound.
export async function mintUniquePublicCode(
  ctx: MutationCtx,
  table: "tournaments" | "conventions",
): Promise<string> {
  return await mintUniqueCode(PUBLIC_CODE_LENGTH, async (code) => {
    const taken =
      table === "tournaments"
        ? await ctx.db
            .query("tournaments")
            .withIndex("by_publicCode", (q) => q.eq("publicCode", code))
            .first()
        : await ctx.db
            .query("conventions")
            .withIndex("by_publicCode", (q) => q.eq("publicCode", code))
            .first();
    return taken !== null;
  });
}

// Parses an event public code as it arrives from a URL or a keyboard (see
// normalizeCode). Returns the canonical stored form, or null for anything
// that doesn't fit, so callers treat unknown and malformed codes identically.
export function parsePublicCode(value: string) {
  return normalizeCode(value, PUBLIC_CODE_LENGTH);
}

// Allocates the next value from a per-entity counter in `appCounters`. Only
// users still number their public codes this way.
export async function nextPublicCode(
  ctx: MutationCtx,
  key: string,
  first: number,
  now = Date.now(),
) {
  const counter = await ctx.db
    .query("appCounters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!counter) {
    await ctx.db.insert("appCounters", {
      key,
      nextValue: first + 1,
      updatedAt: now,
    });
    return first;
  }

  await ctx.db.patch(counter._id, {
    nextValue: counter.nextValue + 1,
    updatedAt: now,
  });
  return counter.nextValue;
}

// Parses a user's public code as it arrives from a profile URL. Returns null
// for anything that is not a positive integer with no leading zeros, so
// callers can treat unknown and malformed codes identically.
export function parseUserPublicCode(value: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const publicCode = Number(value);
  if (!Number.isSafeInteger(publicCode)) {
    return null;
  }
  return publicCode;
}
