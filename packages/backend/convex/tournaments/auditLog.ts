import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "../_generated/server";
import { clampPageSize } from "../model/pagination";
import { requireOrganizerAccess } from "../model/tournaments";

// Mirrors REGISTRATION_PAGE_SIZE in tournaments/registrations.ts: this is the
// same shape of organizer-facing admin history list, so it gets the same
// ceiling.
const AUDIT_EVENTS_PAGE_SIZE = 100;

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
    // No maximumRowsRead: this walk is a plain index-equality prefix with no
    // post-index filter, so every row read is a row returned. A cap here
    // would buy no headroom — it would just equal numItems and trip on every
    // full page (rowsRead reaches the cap on the same doc that fills the
    // page), flagging a healthy page as SplitRequired/SplitRecommended and
    // making usePaginatedQuery split and re-issue it instead of settling.
    return await ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(
          args.paginationOpts.numItems,
          AUDIT_EVENTS_PAGE_SIZE,
        ),
      });
  },
});
