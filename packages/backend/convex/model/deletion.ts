import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { matchPlayers, roundMatches } from "./tournaments";

// Deletion budget per transaction. Each invocation deletes at most this many
// documents so a max-capacity tournament stays within Convex transaction
// limits; callers reschedule until cleared.
const DELETE_BATCH_SIZE = 512;

// Deletes up to DELETE_BATCH_SIZE operational documents for a tournament:
// phases with their rounds, matches, match players, and standings, then
// registrations, test players (and their synthetic users), audit events, and
// test configs.
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

  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= phases.length === 16;

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
        if (budget < players.length + 1) {
          return false;
        }
        for (const player of players) {
          await ctx.db.delete(player._id);
          budget -= 1;
        }
        await ctx.db.delete(match._id);
        budget -= 1;
      }
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      sawFullPage ||= standings.length === 512;
      for (const standing of standings) {
        if (budget < 1) {
          return false;
        }
        await ctx.db.delete(standing._id);
        budget -= 1;
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
    sawFullPage ||= seats.length === 512;
    for (const seat of seats) {
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(seat._id);
      budget -= 1;
    }
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(phase._id);
    budget -= 1;
  }

  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= registrations.length === 512;
  for (const registration of registrations) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(registration._id);
    budget -= 1;
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
    await ctx.db.delete(testPlayer.userId);
    budget -= 2;
  }

  const auditEvents = await ctx.db
    .query("tournamentAuditEvents")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= auditEvents.length === 512;
  for (const auditEvent of auditEvents) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(auditEvent._id);
    budget -= 1;
  }

  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= configs.length === 16;
  for (const config of configs) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(config._id);
    budget -= 1;
  }

  return !sawFullPage;
}
