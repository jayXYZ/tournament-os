import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import {
  inviteForTournament,
  mintUniqueInviteCode,
  normalizeInviteCode,
} from "../model/invites";
import { requireOrganizerAccess } from "../model/tournaments";

// The tournament's live invite code, for the organizer settings surface.
// This is the only query that returns the code: everything player-facing
// takes a code in and answers yes/no, so the secret never rides along on a
// tournament read.
export const getInviteLink = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    const invite = await inviteForTournament(ctx, args.tournamentId);
    return invite ? { code: invite.code } : null;
  },
});

// Resolves an invite code to the event page it opens — the /join/<code> URL's
// lookup. Returns only the routing identifiers, not event details: the event
// page query (getPublicTournament, invite code in hand) is the one place
// invite holders read the event from. Unknown, malformed, revoked, and
// pre-publication codes all resolve to null identically, so the URL leaks
// nothing about which codes exist.
export const resolveInviteCode = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const code = normalizeInviteCode(args.inviteCode);
    if (code === null) {
      return null;
    }
    const invite = await ctx.db
      .query("tournamentInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!invite) {
      return null;
    }
    const tournament = await ctx.db.get(invite.tournamentId);
    if (!tournament || tournament.lifecycle === "setup") {
      return null;
    }
    // The normalized code goes back so the redirect carries the canonical
    // form instead of whatever lookalike spelling arrived.
    return { publicCode: String(tournament.publicCode), inviteCode: code };
  },
});

// Creates the tournament's invite link, or rotates it: minting and replacing
// are the same act, because issuing a fresh code always invalidates every
// previously shared link. Like updateTournamentVisibility this carries no
// lifecycle gate — an organizer can rotate a leaked code whenever — and no
// rate limit: it upserts a single row per tournament, so there is no write
// amplification to meter (see rateLimits.ts).
export const regenerateInviteLink = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<string> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const code = await mintUniqueInviteCode(ctx);
    const existing = await inviteForTournament(ctx, tournament._id);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { code, updatedAt: now });
    } else {
      await ctx.db.insert("tournamentInvites", {
        tournamentId: tournament._id,
        code,
        updatedAt: now,
      });
    }
    return code;
  },
});

// Deletes the invite link outright. Registrations it admitted stand — the
// link is an entry door, not a membership — and disabling is freely
// reversible by regenerating, which issues a fresh code.
export const disableInviteLink = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const existing = await inviteForTournament(ctx, tournament._id);
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return tournament._id;
  },
});
