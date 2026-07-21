import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { MAX_TOURNAMENT_PLAYERS } from "./registrations";

export type TournamentPhaseCutoff = NonNullable<
  Doc<"tournamentPhases">["phaseCutoff"]
>;

// A completed round's standings joined to their registrations, in rank order,
// restricted to players still active — a drop after the round completed
// removes the player from any cut computed against it.
export async function activeStandingsRegistrations(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);

  const registrations = await mapAsyncInBatches(
    standings,
    DATABASE_IO_BATCH_SIZE,
    async (standing) => await ctx.db.get(standing.playerId),
  );
  const rows: Array<{
    standing: Doc<"roundStandings">;
    registration: Doc<"tournamentRegistrations">;
  }> = [];
  standings.forEach((standing, index) => {
    const registration = registrations[index];
    if (registration?.status === "active") {
      rows.push({ standing, registration });
    }
  });
  return rows;
}

// Who survives a phase's configured cutoff, judged against the phase-final
// round's standings. Can return fewer than two players (a points bar nobody
// cleared); callers decide whether that ends the tournament or is an error.
export async function cutoffQualifiers(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
) {
  const rows = await activeStandingsRegistrations(ctx, roundId);
  const qualified =
    cutoff.kind === "top_X_players"
      ? rows.slice(0, cutoff.playerCount)
      : rows.filter(
          ({ standing }) => standing.matchPoints >= cutoff.matchPoints,
        );
  return qualified.map(({ registration }) => registration);
}

// Once a cutoff phase's player meeting starts, its seats are the authoritative
// entry snapshot for the next phase. Live registration status still removes a
// dropped qualifier, but an unseated non-qualifier cannot be backfilled after
// the meeting is underway.
async function activeMeetingRegistrations(
  ctx: QueryCtx,
  phaseId: Id<"tournamentPhases">,
) {
  const seats = await ctx.db
    .query("playerMeetingSeats")
    .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
      q.eq("tournamentPhaseId", phaseId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  const registrations = await mapAsyncInBatches(
    seats,
    DATABASE_IO_BATCH_SIZE,
    async (seat) => await ctx.db.get(seat.registrationId),
  );
  return registrations.filter(
    (registration): registration is Doc<"tournamentRegistrations"> =>
      registration?.status === "active",
  );
}

export async function cutoffQualifiersForNextPhase(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
  nextPhase: Doc<"tournamentPhases">,
) {
  return nextPhase.playerMeetingStatus === "in_progress"
    ? await activeMeetingRegistrations(ctx, nextPhase._id)
    : await cutoffQualifiers(ctx, roundId, cutoff);
}
