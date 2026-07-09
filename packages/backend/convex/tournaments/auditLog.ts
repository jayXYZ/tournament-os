import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "../_generated/server";
import { requireOrganizerAccess } from "../model/tournaments";

// The tournament's audit trail, newest first. Organizer-only: the log exists
// for dispute resolution and can reference players who are no longer on the
// public roster.
export const listAuditEvents = query({
  args: {
    tournamentId: v.id("tournaments"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    return await ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
