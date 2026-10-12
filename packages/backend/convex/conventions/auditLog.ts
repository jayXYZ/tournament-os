import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "../_generated/server";
import { withOrganizerBadgeNames } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { requireConventionOrganizerAccess } from "../model/conventions";
import { ORGANIZER_LIST_PAGE_SIZE, clampPageSize } from "../model/pagination";

// The convention's audit trail, newest first. Organizer-only, mirroring
// tournaments/auditLog.ts.
export const listAuditEvents = query({
  args: {
    conventionId: v.id("conventions"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    const result = await ctx.db
      .query("conventionAuditEvents")
      .withIndex("by_conventionId", (q) =>
        q.eq("conventionId", args.conventionId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(
          args.paginationOpts.numItems,
          ORGANIZER_LIST_PAGE_SIZE,
        ),
      });
    // Same read-time labelling as tournaments/auditLog.ts for nameless
    // badge holders.
    return {
      ...result,
      page: await mapAsyncInBatches(
        result.page,
        DATABASE_IO_BATCH_SIZE,
        async (row) => ({
          ...row,
          event: await withOrganizerBadgeNames(ctx, row.event),
        }),
      ),
    };
  },
});
