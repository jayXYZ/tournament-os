import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteResultRevisionsForMatch } from "./matchResults";
import { MAX_TOURNAMENT_PHASES } from "./phases";
import { matchPlayers, roundMatches } from "./tournaments";

// Deletion budget per transaction. Each invocation deletes at most this many
// documents so a max-capacity tournament stays within Convex transaction
// limits; callers reschedule until cleared.
const DELETE_BATCH_SIZE = 512;

// Deletes up to DELETE_BATCH_SIZE operational documents for a tournament:
// phases with their rounds, matches, match players, standings, and
// player-meeting seats, then decklists, registrations, test players (and
// their synthetic users), audit events, test configs, and the invite link.
// Returns true once everything is cleared; false means more data remains and
// the caller should run another batch (e.g. by rescheduling itself via
// ctx.scheduler.runAfter).
export async function deleteTournamentOperationalDataBatch(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<boolean> {
  let budget = DELETE_BATCH_SIZE;
  // When a page comes back full there may be rows beyond the cursor, so the
  // pass cannot prove the tournament is cleared even if budget remains.
  let sawFullPage = false;

  // Deletes one fetched page of rows under the shared budget. False means the
  // budget ran out mid-page and the caller should stop the pass.
  const drainPage = async (
    rows: Array<{ _id: Id<TableNames> }>,
    pageSize: number,
  ): Promise<boolean> => {
    sawFullPage ||= rows.length === pageSize;
    for (const row of rows) {
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(row._id);
      budget -= 1;
    }
    return true;
  };

  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(MAX_TOURNAMENT_PHASES);
  sawFullPage ||= phases.length === MAX_TOURNAMENT_PHASES;

  for (const phase of phases) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(128);
    sawFullPage ||= rounds.length === 128;
    for (const round of rounds) {
      const matches = await roundMatches(ctx, round._id);
      sawFullPage ||= matches.length === 512;
      for (const match of matches) {
        const players = await matchPlayers(ctx, match._id);
        // Revisions per match are bounded by result overrides — budget a
        // handful alongside the player rows and the match itself.
        if (budget < players.length + 8) {
          return false;
        }
        for (const player of players) {
          await ctx.db.delete(player._id);
          budget -= 1;
        }
        budget -= await deleteResultRevisionsForMatch(ctx, match._id);
        await ctx.db.delete(match._id);
        budget -= 1;
      }
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      if (!(await drainPage(standings, 512))) {
        return false;
      }
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(round._id);
      budget -= 1;
    }
    const seats = await ctx.db
      .query("playerMeetingSeats")
      .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(512);
    if (!(await drainPage(seats, 512))) {
      return false;
    }
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(phase._id);
    budget -= 1;
  }

  const decklists = await ctx.db
    .query("tournamentDecklists")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  if (!(await drainPage(decklists, 512))) {
    return false;
  }

  // Payment rows are only reachable here after the delete guard proved every
  // order terminal and every refund settled (deleteTournament); the rows are
  // pure history by now.
  const payouts = await ctx.db
    .query("tournamentPayouts")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(4);
  for (const payout of payouts) {
    const transfers = await ctx.db
      .query("payoutTransfers")
      .withIndex("by_payoutId_and_status", (q) => q.eq("payoutId", payout._id))
      .take(512);
    sawFullPage ||= transfers.length === 512;
    for (const transfer of transfers) {
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(transfer._id);
      budget -= 1;
    }
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(payout._id);
    budget -= 1;
  }

  const paymentRefunds = await ctx.db
    .query("paymentRefunds")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(512);
  sawFullPage ||= paymentRefunds.length === 512;
  for (const paymentRefund of paymentRefunds) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(paymentRefund._id);
    budget -= 1;
  }

  const paymentOrders = await ctx.db
    .query("paymentOrders")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(512);
  sawFullPage ||= paymentOrders.length === 512;
  for (const paymentOrder of paymentOrders) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(paymentOrder._id);
    budget -= 1;
  }

  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(512);
  if (!(await drainPage(registrations, 512))) {
    return false;
  }

  const testPlayers = await ctx.db
    .query("testTournamentPlayers")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= testPlayers.length === 512;
  for (const testPlayer of testPlayers) {
    if (budget < 2) {
      return false;
    }
    await ctx.db.delete(testPlayer._id);
    // A dummy player's Guest participant belongs to this tournament alone,
    // so it dies with the test data.
    await ctx.db.delete(testPlayer.participantId);
    budget -= 2;
  }

  const auditEvents = await ctx.db
    .query("tournamentAuditEvents")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  if (!(await drainPage(auditEvents, 512))) {
    return false;
  }

  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  if (!(await drainPage(configs, 16))) {
    return false;
  }

  // At most one invite row exists per tournament, but sweep like the rest so
  // the invariant lives in the invite mutations alone.
  const invites = await ctx.db
    .query("tournamentInvites")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= invites.length === 16;
  for (const invite of invites) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(invite._id);
    budget -= 1;
  }

  return !sawFullPage;
}
