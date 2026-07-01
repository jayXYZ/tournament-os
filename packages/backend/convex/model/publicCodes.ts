import type { MutationCtx } from "../_generated/server";

// Public codes are the human-facing, URL-safe identifiers for tournaments and
// players, allocated from per-entity counters in `appCounters` so URLs never
// expose Convex document ids. Each entity owns its own counter (see the
// COUNTER_KEY / FIRST_* constants in its model file); collisions across entities
// are irrelevant because they live in different tables and routes.
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

// Parses a public code as it arrives from a URL. Returns null for anything that
// is not a positive integer with no leading zeros, so callers can treat unknown
// and malformed codes identically (null rather than throwing).
export function parsePublicCode(value: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const publicCode = Number(value);
  if (!Number.isSafeInteger(publicCode)) {
    return null;
  }
  return publicCode;
}
