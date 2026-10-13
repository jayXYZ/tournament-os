import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import {
  inviteForTournament,
  mintUniqueInviteCode,
  normalizeInviteCode,
} from "../model/invites";
import { parsePublicCode } from "../model/publicCodes";
import {
  canViewTournament,
  requireOrganizerAccess,
} from "../model/tournaments";

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

// Resolves the code in a /join/<code> URL — from a printed QR code, a shared
// link, or a code typed by hand — to the event page it opens. The two kinds
// differ in length (see model/codes.ts), so the raw text is tried as each:
//
// - A 6-character public code (CONTEXT.md "Public Code") resolves when the
//   caller could open the event page anyway (canViewTournament, the rule
//   getPublicTournament applies), so a public poster stops working the
//   moment its event goes private, except for the players and organizers who
//   could still open the page.
// - A 10-character invite code (CONTEXT.md "Invite Link") resolves through
//   its live invite row, and the normalized code goes back so the redirect
//   carries the canonical form instead of whatever lookalike spelling
//   arrived.
//
// Returns only the routing identifiers, not event details: the event page
// query is the one place a visitor reads the event from. Unknown, malformed,
// revoked, hidden, and pre-publication codes of either kind all resolve to
// null identically, so the URL says nothing about which codes exist or which
// kind a bad one was.
export const resolveJoinCode = query({
  args: { code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ publicCode: string; inviteCode?: string } | null> => {
    const publicCode = parsePublicCode(args.code);
    if (publicCode !== null) {
      const tournament = await ctx.db
        .query("tournaments")
        .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
        .unique();
      if (
        !tournament ||
        tournament.lifecycle === "setup" ||
        !(await canViewTournament(ctx, tournament, undefined))
      ) {
        return null;
      }
      return { publicCode };
    }

    const inviteCode = normalizeInviteCode(args.code);
    if (inviteCode === null) {
      return null;
    }
    const invite = await ctx.db
      .query("tournamentInvites")
      .withIndex("by_code", (q) => q.eq("code", inviteCode))
      .unique();
    if (!invite) {
      return null;
    }
    const tournament = await ctx.db.get(invite.tournamentId);
    if (!tournament || tournament.lifecycle === "setup") {
      return null;
    }
    return { publicCode: tournament.publicCode, inviteCode };
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
