import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mintUniqueCode, normalizeCode } from "./codes";

// Invite links (see CONTEXT.md "Invite Link"): one shared join code per
// tournament that grants view and registration access whatever the event's
// visibility — the way into a private event. The code is a bearer secret, so
// it lives in its own table (see schema.ts "tournamentInvites") and only the
// organizer invite endpoints ever return it.

// 10 characters × 5 bits = 50 bits of entropy: far beyond guessable for a
// tournament join code, short enough to read aloud. Fixed apart from the
// 6-character public code so /join/<code> can tell the two apart (see
// model/codes.ts).
export const INVITE_CODE_LENGTH = 10;

// Parses a code as it arrives from a URL or a keyboard (see normalizeCode).
// Returns the canonical stored form, or null for anything that doesn't fit.
export function normalizeInviteCode(value: string): string | null {
  return normalizeCode(value, INVITE_CODE_LENGTH);
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
// and resolveJoinCode's unique() lookup depends on it.
export async function mintUniqueInviteCode(ctx: MutationCtx): Promise<string> {
  return await mintUniqueCode(INVITE_CODE_LENGTH, async (code) => {
    const taken = await ctx.db
      .query("tournamentInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    return taken !== null;
  });
}
