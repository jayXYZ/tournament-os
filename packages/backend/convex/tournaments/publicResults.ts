import { v } from "convex/values";

import { query } from "../_generated/server";
import {
  publicRoundMatches,
  publicStandings,
  tournamentForPublicView,
} from "../model/publicResults";

// Public Results (CONTEXT.md, model/publicResults.ts): the event page's
// standings and matches. Both take the page's own arguments and admit exactly
// the viewers getPublicTournament admits — signed out included on a public
// event, an invite code on a private one — answering null to everyone else,
// as the page query does.

export const getPublicStandings = query({
  args: { publicCode: v.string(), inviteCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tournament = await tournamentForPublicView(
      ctx,
      args.publicCode,
      args.inviteCode,
    );
    if (!tournament) {
      return null;
    }
    return { standings: await publicStandings(ctx, tournament) };
  },
});

export const getPublicMatches = query({
  args: {
    publicCode: v.string(),
    inviteCode: v.optional(v.string()),
    // Omitted for the default (latest released) round.
    roundId: v.optional(v.id("tournamentRounds")),
  },
  handler: async (ctx, args) => {
    const tournament = await tournamentForPublicView(
      ctx,
      args.publicCode,
      args.inviteCode,
    );
    if (!tournament) {
      return null;
    }
    return await publicRoundMatches(ctx, tournament, args.roundId);
  },
});
