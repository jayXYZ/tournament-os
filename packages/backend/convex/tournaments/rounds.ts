import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import {
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import {
  createRoundWithPairings,
  createSingleEliminationRoundWithPairings,
} from "../model/pairing";
import {
  deleteStandingsForRound,
  matchPointsForResult,
  replaceStandingsForRound,
  type RoundMatchWithPlayers,
} from "../model/standings";
import { pairingsNextStep } from "../model/nextStep";
import {
  eliminateNonQualifiers,
  eliminateSingleEliminationLosers,
  singleEliminationAdvancers,
  singleEliminationRoundName,
  topEightFromStandings,
} from "../model/singleElimination";
import {
  SINGLE_ELIMINATION_FORMAT,
  SINGLE_ELIMINATION_PLAYERS,
  SWISS_FORMAT,
  phaseByOrder,
  phasesInOrder,
  previousTournamentRound,
  requireCurrentPhase,
  requireDecisiveEliminationResult,
  requirePhase,
  requirePlayerMeetingStarted,
  requireResolvedPhaseTotalRounds,
  resolvePhaseTotalRounds,
  roundNumberInPhase,
  selectCurrentPhase,
} from "../model/phases";
import {
  MAX_TOURNAMENT_PLAYERS,
  activeRegistrations,
  adjustActiveRegistrationCount,
  resolveRegistrationDisplayName,
  setRegistrationStatus,
} from "../model/registrations";
import {
  PAIRINGS_REWIND_RECORDED_RESULT_REASON,
  matchPlayers,
  requireMatch,
  requireOrganizerAccess,
  requireRound,
  roundHasRecordedResult,
  roundMatchesWithPlayers,
} from "../model/tournaments";

export const startTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    if (tournament.lifecycle !== "registration") {
      throw new Error("Tournament must be published before it can start");
    }
    const phase = await requireCurrentPhase(ctx, args.tournamentId);
    if (phase.phaseType !== SWISS_FORMAT || phase.phaseOrder !== 1) {
      throw new Error("A tournament must start with a Swiss phase");
    }
    requirePlayerMeetingStarted(phase);
    const registrations = await activeRegistrations(ctx, args.tournamentId);
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }
    const hasTopEightPlayoff = (
      await phasesInOrder(ctx, args.tournamentId)
    ).some((candidate) => candidate.phaseType === SINGLE_ELIMINATION_FORMAT);
    if (
      hasTopEightPlayoff &&
      registrations.length < SINGLE_ELIMINATION_PLAYERS
    ) {
      throw new Error("A top-8 playoff requires at least eight active players");
    }
    const phaseTotalRounds = await resolvePhaseTotalRounds(
      ctx,
      phase,
      registrations.length,
    );
    const playablePhase = { ...phase, phaseTotalRounds };

    const roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase: playablePhase,
      roundNumber: 1,
      registrations,
    });
    const now = Date.now();
    await ctx.db.patch(tournament._id, {
      lifecycle: "in_progress",
      updatedAt: now,
    });
    await ctx.db.patch(playablePhase._id, {
      phaseStatus: "in_progress",
      phaseCurrentRound: roundId,
      // Pairing round 1 ends any live player meeting. Keyed on the status, not
      // the setting, so a meeting started before the flag was frozen still
      // closes cleanly.
      ...(phase.playerMeetingStatus === "in_progress"
        ? { playerMeetingStatus: "completed" as const }
        : {}),
      updatedAt: now,
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "tournament_started",
        playerCount: registrations.length,
      },
    });

    return roundId;
  },
});

export const generateNextRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    const phase = await requireCurrentPhase(ctx, args.tournamentId);
    if (tournament.lifecycle !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }

    const currentRound = await requireRound(ctx, phase.phaseCurrentRound);
    if (currentRound.roundStatus !== "completed") {
      throw new Error("Current round must be completed first");
    }
    // Defensive: completeRound clears the finished round's timer, so this only
    // fires if a stale timer somehow survived; the new round starts without one.
    if (tournament.roundTimer) {
      await ctx.db.patch(tournament._id, {
        roundTimer: undefined,
        updatedAt: Date.now(),
      });
    }
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    const playedInPhase = await roundNumberInPhase(ctx, currentRound);
    const { roundId, playerCount } =
      playedInPhase < phaseTotalRounds
        ? await continuePhaseWithNextRound(ctx, tournament, phase, currentRound)
        : await startNextPhaseFirstRound(ctx, tournament, phase, currentRound);
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "round_started",
        roundId,
        roundNumber: currentRound.roundNumber + 1,
        playerCount,
      },
    });
    return roundId;
  },
});

async function continuePhaseWithNextRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  phase: Doc<"tournamentPhases">,
  currentRound: Doc<"tournamentRounds">,
) {
  const registrations =
    phase.phaseType === SINGLE_ELIMINATION_FORMAT
      ? await singleEliminationAdvancers(ctx, currentRound._id)
      : await activeRegistrations(ctx, tournament._id);
  const roundId =
    phase.phaseType === SINGLE_ELIMINATION_FORMAT
      ? await createSingleEliminationRoundWithPairings(ctx, {
          tournament,
          phase,
          roundNumber: currentRound.roundNumber + 1,
          roundName: singleEliminationRoundName(registrations.length),
          registrations,
          seededFirstRound: false,
        })
      : await createRoundWithPairings(ctx, {
          tournament,
          phase,
          roundNumber: currentRound.roundNumber + 1,
          registrations,
          previousRoundId: currentRound._id,
        });
  await ctx.db.patch(phase._id, {
    phaseCurrentRound: roundId,
    updatedAt: Date.now(),
  });
  return { roundId, playerCount: registrations.length };
}

// The phase's configured rounds are done: start the next phase. Round
// numbering continues across the boundary (day 2 of an 8-round day 1
// starts at round 9), and passing the finished phase's final round as
// previousRoundId carries match points, tiebreakers, and pairing history.
async function startNextPhaseFirstRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  phase: Doc<"tournamentPhases">,
  currentRound: Doc<"tournamentRounds">,
) {
  const nextPhase = await phaseByOrder(
    ctx,
    tournament._id,
    phase.phaseOrder + 1,
  );
  if (!nextPhase || nextPhase.phaseStatus !== "upcoming") {
    throw new Error("All configured rounds have been generated");
  }
  requirePlayerMeetingStarted(nextPhase);
  let registrations = await activeRegistrations(ctx, tournament._id);
  const nextPhaseTotalRounds = await resolvePhaseTotalRounds(
    ctx,
    nextPhase,
    registrations.length,
  );
  const playablePhase = {
    ...nextPhase,
    phaseTotalRounds: nextPhaseTotalRounds,
  };

  let roundId: Id<"tournamentRounds">;
  if (nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    registrations = await topEightFromStandings(ctx, currentRound._id);
    roundId = await createSingleEliminationRoundWithPairings(ctx, {
      tournament,
      phase: playablePhase,
      roundNumber: currentRound.roundNumber + 1,
      roundName: "Quarterfinals",
      registrations,
      seededFirstRound: true,
    });
    // The cut belongs to the completed round whose standings produced it.
    // Rewinding the quarterfinal reopens that round and should restore the
    // cut; rewinding a later bracket round must restore only bracket losers.
    await eliminateNonQualifiers(
      ctx,
      tournament,
      registrations,
      currentRound._id,
    );
  } else {
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }
    roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase: playablePhase,
      roundNumber: currentRound.roundNumber + 1,
      registrations,
      previousRoundId: currentRound._id,
    });
  }
  await ctx.db.patch(nextPhase._id, {
    phaseStatus: "in_progress",
    phaseCurrentRound: roundId,
    // Pairing the phase's first round ends any live player meeting.
    ...(nextPhase.playerMeetingStatus === "in_progress"
      ? { playerMeetingStatus: "completed" as const }
      : {}),
    updatedAt: Date.now(),
  });
  return { roundId, playerCount: registrations.length };
}

export const publishPairings = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const phase = await requirePhase(ctx, round.tournamentPhaseId);
    if (phase.phaseCurrentRound !== round._id) {
      throw new Error("Only the current round's pairings can be published");
    }
    if (round.pairingsPublishedAt !== undefined) {
      return round._id;
    }
    const now = Date.now();
    await ctx.db.patch(round._id, {
      pairingsPublishedAt: now,
      updatedAt: now,
    });
    return round._id;
  },
});

export const recordMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    playerOneRegistrationId: v.id("tournamentRegistrations"),
    playerTwoRegistrationId: v.id("tournamentRegistrations"),
    playerOneGameWins: v.number(),
    playerTwoGameWins: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await requireMatch(ctx, args.matchId);
    const { user } = await requireOrganizerAccess(ctx, match.tournamentId);
    const round = await requireRound(ctx, match.tournamentRoundId);
    if (round.roundStatus !== "in_progress") {
      throw new Error(
        "Match results can only be recorded during an active round",
      );
    }
    const phase = await requirePhase(ctx, match.tournamentPhaseId);
    requireDecisiveEliminationResult(
      phase,
      args.playerOneGameWins,
      args.playerTwoGameWins,
    );
    const players = await matchPlayers(ctx, args.matchId);
    if (players.length !== 2) {
      throw new Error("Match result requires exactly two players");
    }

    const playerOne = players.find(
      (player) => player.playerId === args.playerOneRegistrationId,
    );
    const playerTwo = players.find(
      (player) => player.playerId === args.playerTwoRegistrationId,
    );
    if (!playerOne || !playerTwo) {
      throw new Error("Result players must match the pairing");
    }

    const [playerOnePoints, playerTwoPoints] = matchPointsForResult({
      playerOneGameWins: args.playerOneGameWins,
      playerTwoGameWins: args.playerTwoGameWins,
    });
    // Captured before the patches below overwrite the rows: a non-null value
    // means this call edited an existing result, which the log must preserve.
    const previousResult = existingResultLines(match, players);
    const now = Date.now();
    await ctx.db.patch(playerOne._id, {
      matchPointsEarned: playerOnePoints,
      gameWins: args.playerOneGameWins,
      gameLosses: args.playerTwoGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(playerTwo._id, {
      matchPointsEarned: playerTwoPoints,
      gameWins: args.playerTwoGameWins,
      gameLosses: args.playerOneGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(args.matchId, {
      matchStatus: "completed",
      // An organizer-recorded result supersedes any player self-report; this
      // is also the resolution path when players disagree about a result.
      reportedByRegistrationId: undefined,
      updatedAt: now,
    });
    await logAuditEvent(ctx, {
      tournamentId: match.tournamentId,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "match_result_recorded",
        matchId: args.matchId,
        roundNumber: round.roundNumber,
        tableNumber: match.tableNumber ?? null,
        result: [
          auditResultLine(
            playerOne,
            args.playerOneGameWins,
            args.playerTwoGameWins,
          ),
          auditResultLine(
            playerTwo,
            args.playerTwoGameWins,
            args.playerOneGameWins,
          ),
        ],
        previousResult,
      },
    });
    return args.matchId;
  },
});

export const completeRound = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      round.tournamentId,
    );
    // Load the round's own phase both to prove it is the tournament's current
    // phase and to compute standings against the phase actually being played.
    const phase = await requirePhase(ctx, round.tournamentPhaseId);
    if (tournament.lifecycle !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    const currentPhase = await requireCurrentPhase(ctx, tournament._id);
    if (
      currentPhase._id !== phase._id ||
      currentPhase.phaseCurrentRound !== round._id
    ) {
      throw new Error("Only the current round can be completed");
    }
    if (round.roundStatus !== "in_progress") {
      throw new Error("Current round is not in progress");
    }
    const matchesWithPlayers = await roundMatchesWithPlayers(ctx, args.roundId);
    for (const { match } of matchesWithPlayers) {
      if (
        match.matchStatus !== "completed" &&
        match.matchStatus !== "confirmed"
      ) {
        throw new Error("All matches need results before completing the round");
      }
    }

    await replaceStandingsForRound(
      ctx,
      tournament,
      phase,
      round,
      matchesWithPlayers,
    );
    if (phase.phaseType === SINGLE_ELIMINATION_FORMAT) {
      await eliminateSingleEliminationLosers(
        ctx,
        tournament,
        matchesWithPlayers,
        round._id,
      );
    }
    const now = Date.now();
    await ctx.db.patch(args.roundId, {
      roundStatus: "completed",
      // A completed round is part of the public tournament record. Publishing
      // here prevents organizer-entered results from becoming permanently
      // hidden once phaseCurrentRound advances past an unpublished round.
      pairingsPublishedAt: round.pairingsPublishedAt ?? now,
      updatedAt: now,
    });
    // The round is over, so its timer is too (patching undefined removes it).
    if (tournament.roundTimer?.roundId === args.roundId) {
      await ctx.db.patch(tournament._id, {
        roundTimer: undefined,
        updatedAt: now,
      });
    }
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    if ((await roundNumberInPhase(ctx, round)) >= phaseTotalRounds) {
      await ctx.db.patch(phase._id, {
        phaseStatus: "completed",
        updatedAt: now,
      });
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "round_completed",
        roundId: args.roundId,
        roundNumber: round.roundNumber,
      },
    });
    return args.roundId;
  },
});

export const rewindLatestRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    if (tournament.lifecycle !== "in_progress") {
      throw new Error("Only an in-progress tournament can be rewound");
    }

    const phase = await requireCurrentPhase(ctx, tournament._id);
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }
    const round = await requireRound(ctx, phase.phaseCurrentRound);
    if (round.roundStatus !== "in_progress") {
      throw new Error("Only the current active round can be rewound");
    }

    const matchesWithPlayers = await roundMatchesWithPlayers(ctx, round._id);
    if (roundHasRecordedResult(matchesWithPlayers)) {
      throw new Error(PAIRINGS_REWIND_RECORDED_RESULT_REASON);
    }

    const previousRound = await previousTournamentRound(ctx, round);
    const now = Date.now();
    await restoreEliminationsForRewind(ctx, tournament, [
      round._id,
      ...(previousRound ? [previousRound._id] : []),
    ]);

    for (const { match, players } of matchesWithPlayers) {
      for (const player of players) {
        await ctx.db.delete(player._id);
      }
      await ctx.db.delete(match._id);
    }
    await ctx.db.delete(round._id);

    if (previousRound) {
      await deleteStandingsForRound(ctx, previousRound._id);

      const previousPhase = await requirePhase(
        ctx,
        previousRound.tournamentPhaseId,
      );
      await ctx.db.patch(previousRound._id, {
        roundStatus: "in_progress",
        updatedAt: now,
      });
      await ctx.db.patch(previousPhase._id, {
        phaseStatus: "in_progress",
        phaseCurrentRound: previousRound._id,
        updatedAt: now,
      });
      if (previousPhase._id !== phase._id) {
        await ctx.db.patch(phase._id, {
          phaseStatus: "upcoming",
          phaseCurrentRound: undefined,
          updatedAt: now,
        });
      }
      await ctx.db.patch(tournament._id, {
        roundTimer: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(phase._id, {
        phaseStatus: "upcoming",
        phaseCurrentRound: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(tournament._id, {
        lifecycle: "registration",
        roundTimer: undefined,
        updatedAt: now,
      });
    }

    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "round_rewound",
        removedRoundId: round._id,
        removedRoundNumber: round.roundNumber,
        reopenedRoundId: previousRound?._id ?? null,
        reopenedRoundNumber: previousRound?.roundNumber ?? null,
      },
    });
    return previousRound?._id ?? null;
  },
});

export const getCurrentRound = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireCurrentPhase(ctx, tournament._id);
    if (!phase.phaseCurrentRound) {
      return null;
    }

    return await ctx.db.get(phase.phaseCurrentRound);
  },
});

export const listRoundPairings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const matchesWithPlayers = await roundMatchesWithPlayers(ctx, args.roundId);

    // Names come from the denormalized copy on each match-player row; only rows
    // missing it (legacy data) fall back to a live lookup, keeping this query
    // off the per-row user join that would otherwise blow the read budget.
    return await mapAsyncInBatches(
      matchesWithPlayers,
      DATABASE_IO_BATCH_SIZE,
      async ({ match, players }) => {
        const resolvedPlayers = await Promise.all(
          players.map(async (player) => ({
            ...player,
            playerName: await resolveRegistrationDisplayName(
              ctx,
              player.playerName,
              player.playerId,
            ),
          })),
        );
        return { match, players: resolvedPlayers };
      },
    );
  },
});

export const getPairingsBoard = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phases = await phasesInOrder(ctx, args.tournamentId);

    const phaseBoards = await Promise.all(
      phases.map(async (phase) => ({
        phase,
        rounds: await ctx.db
          .query("tournamentRounds")
          .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
            q.eq("tournamentPhaseId", phase._id),
          )
          .take(64),
      })),
    );

    const currentPhase = selectCurrentPhase(
      phaseBoards.map(({ phase }) => phase),
    );
    const currentRound = currentPhase?.phaseCurrentRound
      ? (phaseBoards
          .find(({ phase }) => phase._id === currentPhase._id)
          ?.rounds.find(
            (round) => round._id === currentPhase.phaseCurrentRound,
          ) ?? null)
      : null;
    const currentMatchesWithPlayers =
      currentRound?.roundStatus === "in_progress"
        ? await roundMatchesWithPlayers(ctx, currentRound._id)
        : null;
    const [nextStep, rewind] = await Promise.all([
      pairingsNextStep(
        ctx,
        tournament,
        phaseBoards,
        currentMatchesWithPlayers?.map(({ match }) => match),
      ),
      rewindAvailability(
        ctx,
        tournament,
        currentRound,
        currentMatchesWithPlayers,
      ),
    ]);

    return {
      tournament,
      phases: phaseBoards,
      nextStep,
      rewind,
    };
  },
});

export const listRoundStandings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", args.roundId),
      )
      .take(MAX_TOURNAMENT_PLAYERS);

    // Denormalized name on the standings row avoids the per-row user join;
    // legacy rows without one fall back to a live lookup.
    return await mapAsyncInBatches(
      standings,
      DATABASE_IO_BATCH_SIZE,
      async (standing) => ({
        standing,
        playerName: await resolveRegistrationDisplayName(
          ctx,
          standing.playerName,
          standing.playerId,
        ),
      }),
    );
  },
});

type RewindAvailability = {
  eligible: boolean;
  reason: string | null;
  removedRoundNumber: number | null;
  reopenedRoundNumber: number | null;
};

async function rewindAvailability(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds"> | null,
  prefetchedMatches: RoundMatchWithPlayers[] | null,
): Promise<RewindAvailability> {
  if (tournament.lifecycle !== "in_progress") {
    return {
      eligible: false,
      reason: "Only an in-progress tournament can be rewound",
      removedRoundNumber: null,
      reopenedRoundNumber: null,
    };
  }

  if (!round || round.roundStatus !== "in_progress") {
    return {
      eligible: false,
      reason: "Only the current active round can be rewound",
      removedRoundNumber: round?.roundNumber ?? null,
      reopenedRoundNumber: null,
    };
  }

  const matchesWithPlayers =
    prefetchedMatches ?? (await roundMatchesWithPlayers(ctx, round._id));
  const hasResult = roundHasRecordedResult(matchesWithPlayers);
  const previousRound = await previousTournamentRound(ctx, round);
  return {
    eligible: !hasResult,
    reason: hasResult ? PAIRINGS_REWIND_RECORDED_RESULT_REASON : null,
    removedRoundNumber: round.roundNumber,
    reopenedRoundNumber: previousRound?.roundNumber ?? null,
  };
}

async function restoreEliminationsForRewind(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  roundIds: Id<"tournamentRounds">[],
) {
  const sourceIds = new Set(roundIds);
  const eliminated = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournament._id).eq("status", "eliminated"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  const restored: Doc<"tournamentRegistrations">[] = [];
  for (const registration of eliminated) {
    if (
      registration.eliminatedByRoundId !== undefined &&
      sourceIds.has(registration.eliminatedByRoundId)
    ) {
      restored.push(registration);
    }
  }
  const now = Date.now();
  await mapAsyncInBatches(
    restored,
    DATABASE_IO_BATCH_SIZE,
    async (registration) =>
      await setRegistrationStatus(ctx, registration._id, {
        status: "active",
        updatedAt: now,
      }),
  );
  await adjustActiveRegistrationCount(ctx, tournament, restored.length, now);
}
