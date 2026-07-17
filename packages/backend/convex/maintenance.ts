import { internalMutation } from "./_generated/server";
import type { TableNames } from "./_generated/dataModel";

const allTables: TableNames[] = [
  "users",
  "organizations",
  "organizationMemberships",
  "organizationInvitations",
  "appCounters",
  "tournaments",
  "tournamentRegistrations",
  "tournamentPhases",
  "playerMeetingSeats",
  "tournamentRounds",
  "tournamentMatches",
  "tournamentMatchPlayers",
  "roundStandings",
  "tournamentAuditEvents",
  "tournamentTestConfigs",
  "testTournamentPlayers",
];

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
