import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Invite links (see CONTEXT.md "Invite Link"): one shared join code per
// tournament that grants view and registration access whatever the event's
// visibility — the way into a private event. The code is a bearer secret, so
// it lives in its own table (see schema.ts "tournamentInvites") and only the
// organizer invite endpoints ever return it.

// Crockford base32: no I, L, O, or U, so a code read aloud or off a phone
// screen has no lookalike ambiguity — normalizeInviteCode maps the excluded
// letters back onto the digits they resemble. 32 characters also divide 256
// evenly, so sampling bytes modulo the alphabet is unbiased.
const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 10 characters × 5 bits = 50 bits of entropy: far beyond guessable for a
// tournament join code, short enough to read aloud.
export const INVITE_CODE_LENGTH = 10;

const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  return Array.from(
    bytes,
    (byte) => INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length],
  ).join("");
}

// Parses a code as it arrives from a URL or a keyboard: case-insensitive,
// separator-tolerant, and forgiving of the lookalike characters the alphabet
// excludes. Returns the canonical stored form, or null for anything that
// still doesn't fit — callers treat unknown and malformed codes identically.
export function normalizeInviteCode(value: string): string | null {
  const normalized = value
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return INVITE_CODE_PATTERN.test(normalized) ? normalized : null;
}

// At most one invite row exists per tournament (the management mutations
// upsert through this index), so unique() is safe.
export async function inviteForTournament(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentInvites")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .unique();
}

// Whether a caller-supplied code is the tournament's live invite code. Setup
// events are excluded outright: an invite link is a sharing surface, and
// nothing is shareable before publication (matching isPubliclyViewable).
// This is only an access grant — it never overrides entry decisions
// (a rejected row stays rejected), capacity, or lifecycle gates, all of
// which the callers keep enforcing on top.
export async function inviteCodeGrantsAccess(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  rawCode: string | undefined,
): Promise<boolean> {
  if (rawCode === undefined || tournament.lifecycle === "setup") {
    return false;
  }
  const code = normalizeInviteCode(rawCode);
  if (code === null) {
    return false;
  }
  const invite = await inviteForTournament(ctx, tournament._id);
  return invite !== null && invite.code === code;
}

// Mints a code no other tournament holds. Collisions are astronomically
// unlikely at 50 bits, but the by_code index makes ruling them out one read,
// and resolveInviteCode's unique() lookup depends on it.
export async function mintUniqueInviteCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const taken = await ctx.db
      .query("tournamentInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!taken) {
      return code;
    }
  }
  throw new Error("Could not generate an invite code");
}
