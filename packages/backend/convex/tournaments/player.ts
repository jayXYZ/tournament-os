import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import {
  applyMatchResult,
  concedeUnfinishedMatchOnDrop,
} from "../model/matchResults";
import {
  MAX_MATCHES_PER_PLAYER,
  latestCompletedRound,
  requirePhase,
  roundNumberInPhase,
  phaseByOrder,
  phasesInOrder,
  selectCurrentPhase,
} from "../model/phases";
import { setRegistrationState } from "../model/participation";
import {
  MAX_TOURNAMENT_PLAYERS,
  playerVisibleParticipationStatus,
  playerVisibleRegistration,
  registrationForUser,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import { matchLogForRegistration } from "../model/playerResults";
import {
  isPairingsVisibleToPlayers,
  matchPlayers,
  requireMatch,
  requireRegisteredPlayer,
  requireRound,
  requireTournament,
} from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";

type OpponentSummary = {
  registrationId: Id<"tournamentRegistrations">;
  name: string | null;
  avatarUrl: string | null;
};

export const getMyCurrentMatch = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament, registration: storedRegistration } =
      await requireRegisteredPlayer(ctx, args.tournamentId);
    // The rest of the handler only distinguishes active from non-active, so
    // building the whole payload from the masked row changes nothing but the
    // reported status: a disqualified player reads as dropped, and the
    // clients' existing dropped branches render the removed-from-event state.
    const registration = playerVisibleRegistration(storedRegistration);
    const base = {
      tournament: {
        name: tournament.name,
        lifecycle: tournament.lifecycle,
        roundTimer: tournament.roundTimer ?? null,
      },
      myRegistrationStatus: registration.participationStatus,
      myRegistrationId: registration._id,
    };

    const phases = await phasesInOrder(ctx, args.tournamentId);
    const phase = selectCurrentPhase(phases);

    // A live player meeting takes over the play surface: until the phase's
    // first round is paired, the player's "match" is their alphabetical seat.
    // Covers a phase-1 meeting (lifecycle "setup"/"registration", matching
    // where startPlayerMeeting allows one) and a later-phase meeting held
    // between phases (lifecycle "in_progress").
    const meetingPhase =
      tournament.lifecycle !== "completed" &&
      tournament.lifecycle !== "cancelled"
        ? phases.find(
            (candidate) => candidate.playerMeetingStatus === "in_progress",
          )
        : undefined;
    if (meetingPhase) {
      const seat = await ctx.db
        .query("playerMeetingSeats")
        .withIndex("by_tournamentPhaseId_and_registrationId", (q) =>
          q
            .eq("tournamentPhaseId", meetingPhase._id)
            .eq("registrationId", registration._id),
        )
        .unique();
      // A later meeting fed by a cutoff is invitation-only: an active player
      // without a seat did not qualify and should remain on the completed-round
      // view. Phase-1 meetings preserve the existing late-registration fallback.
      const previousPhase =
        !seat && meetingPhase.phaseOrder > 1
          ? await phaseByOrder(
              ctx,
              args.tournamentId,
              meetingPhase.phaseOrder - 1,
            )
          : null;
      const excludedByCutoff =
        !seat && (previousPhase?.phaseCutoff ?? null) !== null;
      if (!excludedByCutoff) {
        let seatmateName: string | null = null;
        if (seat) {
          const tableSeats = await ctx.db
            .query("playerMeetingSeats")
            .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
              q
                .eq("tournamentPhaseId", meetingPhase._id)
                .eq("tableNumber", seat.tableNumber),
            )
            .take(2);
          seatmateName =
            tableSeats.find((other) => other._id !== seat._id)?.playerName ??
            null;
        }
        return {
          kind: "player_meeting" as const,
          ...base,
          meeting: {
            phaseName:
              meetingPhase.phaseName ?? `Phase ${meetingPhase.phaseOrder}`,
            // null: registered after a non-cutoff seating snapshot.
            tableNumber: seat?.tableNumber ?? null,
            seatmateName,
          },
        };
      }
    }

    if (
      tournament.lifecycle === "setup" ||
      tournament.lifecycle === "registration" ||
      !phase?.phaseCurrentRound
    ) {
      return { kind: "not_started" as const, ...base };
    }

    const round = await requireRound(ctx, phase.phaseCurrentRound);
    // Round numbers are global across phases, so the phase's round count is
    // compared against the round's position within the phase.
    const isFinalRoundOfPhase =
      phase.phaseTotalRounds !== null &&
      (await roundNumberInPhase(ctx, round)) >= phase.phaseTotalRounds;
    // The tournament's final round is the last round of the last phase: a
    // later phase means more rounds follow even after this phase ends.
    const nextPhase = isFinalRoundOfPhase
      ? await phaseByOrder(ctx, args.tournamentId, phase.phaseOrder + 1)
      : null;
    const roundSummary = {
      roundNumber: round.roundNumber,
      roundName: round.roundName,
      roundStatus: round.roundStatus,
      isFinalRound: isFinalRoundOfPhase && nextPhase === null,
    };
    if (!isPairingsVisibleToPlayers(round)) {
      // Inactive registrations can still belong to this round when a player
      // drops after pairings are generated. Preserve the pending state for
      // those players, but do not promise a future pairing to dropped or
      // eliminated players who were excluded before this round was paired.
      if (
        registration.participationStatus !== "active" &&
        !(await playerMatchInRound(ctx, registration._id, round._id))
      ) {
        return { kind: "no_match" as const, ...base, round: roundSummary };
      }
      return {
        kind: "pairings_pending" as const,
        ...base,
        round: roundSummary,
      };
    }
    if (round.roundStatus === "completed") {
      return { kind: "between_rounds" as const, ...base, round: roundSummary };
    }

    const found = await playerMatchInRound(ctx, registration._id, round._id);
    if (!found) {
      return { kind: "no_match" as const, ...base, round: roundSummary };
    }

    const { match, myRow } = found;
    const players = await matchPlayers(ctx, match._id);
    const opponentRow = players.find((player) => player._id !== myRow._id);
    let opponent: OpponentSummary | null = null;
    if (opponentRow) {
      const opponentRegistration = await ctx.db.get(opponentRow.playerId);
      const opponentUser = opponentRegistration
        ? await ctx.db.get(opponentRegistration.userId)
        : null;
      opponent = {
        registrationId: opponentRow.playerId,
        name: opponentUser?.name ?? null,
        avatarUrl: opponentUser?.avatarUrl ?? null,
      };
    }

    return {
      kind: "match" as const,
      ...base,
      round: roundSummary,
      match: {
        _id: match._id,
        tableNumber: match.tableNumber ?? null,
        matchStatus: match.matchStatus,
        reportedByRegistrationId: match.reportedByRegistrationId ?? null,
        // The phase's Match Structure, so result entry can cap game wins at
        // what the structure allows instead of hardcoding best-of-3.
        bestOf: phase.bestOf,
      },
      me: {
        registrationId: registration._id,
        gameWins: myRow.gameWins ?? null,
        gameLosses: myRow.gameLosses ?? null,
        gameDraws: myRow.gameDraws ?? null,
        isBye: myRow.isBye,
      },
      opponent,
    };
  },
});

export const getMyMatchHistory = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    return await matchLogForRegistration(
      ctx,
      args.tournamentId,
      registration._id,
    );
  },
});

export const getLatestStandings = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { registration } = await requireRegisteredPlayer(
      ctx,
      args.tournamentId,
    );
    const latestCompleted = await latestCompletedRound(ctx, args.tournamentId);
    if (!latestCompleted) {
      return null;
    }

    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", latestCompleted._id),
      )
      .take(MAX_TOURNAMENT_PLAYERS);
    // Every player in the event subscribes to this query, so it reads no
    // registration documents at all: participation status is denormalized onto
    // the standings row, and the participation module writes each change
    // through to the latest completed round's rows (see model/participation.ts).
    // A drop or reinstate between rounds therefore still shows immediately —
    // it patches the very rows this query reads — while a 500-player field no
    // longer costs one read and one subscription dependency per non-active
    // player on every execution.
    const rows = await mapAsyncInBatches(
      standings,
      DATABASE_IO_BATCH_SIZE,
      async (standing) => {
        const name = await resolveRegistrationDisplayName(
          ctx,
          standing.playerName,
          standing.playerId,
        );
        return {
          rank: standing.rank,
          name: name ?? null,
          matchPoints: standing.matchPoints,
          matchWins: standing.matchWins,
          matchLosses: standing.matchLosses,
          matchDraws: standing.matchDraws,
          opponentMatchWinPct: standing.opponentMatchWinPct,
          gameWinPct: standing.gameWinPct,
          opponentGameWinPct: standing.opponentGameWinPct,
          playoffStatus: standing.playoffStatus,
          eliminatedInRoundNumber: standing.eliminatedInRoundNumber ?? null,
          registrationStatus: playerVisibleParticipationStatus(
            standing.participationStatus ?? "active",
          ),
          isMe: standing.playerId === registration._id,
        };
      },
    );

    return { roundNumber: latestCompleted.roundNumber, rows };
  },
});

export const reportMyMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    myGameWins: v.number(),
    opponentGameWins: v.number(),
    gameDraws: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "reportResult");
    const { match, round, myRow, opponentRow, user } =
      await requireMatchParticipant(ctx, args.matchId);
    await applyMatchResult(ctx, {
      match,
      phase: await requirePhase(ctx, match.tournamentPhaseId),
      round,
      players: [myRow, opponentRow],
      playerOneGameWins: args.myGameWins,
      playerTwoGameWins: args.opponentGameWins,
      gameDraws: args.gameDraws ?? 0,
      policy: {
        kind: "player",
        actor: user,
        reporterRegistrationId: myRow.playerId,
      },
    });
    return match._id;
  },
});

export const dropSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "dropSelf");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (tournament.lifecycle !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (
      !registration ||
      registration.entryStatus !== "confirmed" ||
      registration.participationStatus !== "active"
    ) {
      throw new Error("Active registration not found");
    }

    const now = Date.now();
    await setRegistrationState(ctx, registration._id, {
      entryStatus: "confirmed",
      participationStatus: "dropped",
      updatedAt: now,
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: { type: "player_dropped", player: auditPlayerRef(registration) },
    });
    // A drop during the player's own unfinished match concedes it (see
    // CONTEXT.md "Concession").
    await concedeUnfinishedMatchOnDrop(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "player",
    });
    return registration._id;
  },
});

async function playerMatchInRound(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
  roundId: Id<"tournamentRounds">,
) {
  const playerRows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
    .take(MAX_MATCHES_PER_PLAYER);
  for (const myRow of playerRows) {
    const match = await ctx.db.get(myRow.tournamentMatchId);
    if (match && match.tournamentRoundId === roundId) {
      return { match, myRow };
    }
  }
  return null;
}

// Being one of the match's two players is the authorization — participation
// status is not checked, because a match can outlive it (a drop concedes the
// player's own unfinished match, but never touches a finished one).
async function requireMatchParticipant(
  ctx: MutationCtx,
  matchId: Id<"tournamentMatches">,
) {
  const user = await ensureCurrentUser(ctx);
  const match = await requireMatch(ctx, matchId);
  const tournament = await requireTournament(ctx, match.tournamentId);
  if (tournament.lifecycle !== "in_progress") {
    throw new Error("Tournament is not in progress");
  }
  const round = await requireRound(ctx, match.tournamentRoundId);
  if (!isPairingsVisibleToPlayers(round)) {
    throw new Error("Pairings have not been published");
  }
  const registration = await registrationForUser(
    ctx,
    match.tournamentId,
    user._id,
  );
  if (!registration) {
    throw new Error("Not registered for this tournament");
  }

  const players = await matchPlayers(ctx, matchId);
  if (players.length !== 2) {
    throw new Error("Only two-player matches can be reported by players");
  }
  const myRow = players.find((player) => player.playerId === registration._id);
  if (!myRow) {
    throw new Error("You are not part of this match");
  }
  const opponentRow = players.find((player) => player._id !== myRow._id);
  if (!opponentRow) {
    throw new Error("Opponent not found for this match");
  }

  return {
    match,
    round,
    tournament,
    registration,
    players,
    myRow,
    opponentRow,
    user,
  };
}
