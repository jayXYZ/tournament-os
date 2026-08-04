import { internalMutation } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";
import schema from "./schema";

// Every table in the schema, derived rather than hard-coded so a newly added
// table can never be forgotten here. The cast is sound because TableNames is
// generated from this same schema definition.
const allTables = Object.keys(schema.tables) as TableNames[];

// Dev-only reset. Internal so it is not callable from clients; run it from the
// repository root with `pnpm db:wipe`.
export const wipeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of allTables) {
      for (;;) {
        const rows = await ctx.db.query(table).take(500);
        if (rows.length === 0) {
          break;
        }
        for (const row of rows) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    }
    return { deleted };
  },
});
