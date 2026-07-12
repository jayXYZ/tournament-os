import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { mutation, query } from "../_generated/server";
import {
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "../model/auditLog";
import {
  createRoundWithPairings,
  createSingleEliminationRoundWithPairings,
} from "../model/pairing";
import {
  matchPointsForResult,
  replaceStandingsForRound,
  type RoundMatchWithPlayers,
} from "../model/standings";
import {
  MAX_TOURNAMENT_PLAYERS,
  SINGLE_ELIMINATION_FORMAT,
  SINGLE_ELIMINATION_PLAYERS,
  SWISS_FORMAT,
  activeRegistrations,
  adjustActiveRegistrationCount,
  matchPlayers,
  pairingsNextStep,
  phaseByOrder,
  phasesInOrder,
  registrationDisplayName,
  requireMatch,
  requireCurrentPhase,
  requireDecisiveEliminationResult,
  requireOrganizerAccess,
  requirePhase,
  requirePlayerMeetingStarted,
  requireResolvedPhaseTotalRounds,
  requireRound,
  requireSetupEditable,
  resolvePhaseTotalRounds,
  roundMatches,
  roundMatchesWithPlayers,
  roundNumberInPhase,
} from "../model/tournaments";

export const startTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    requireSetupEditable(tournament);
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
    if (playedInPhase < phaseTotalRounds) {
      const registrations =
        phase.phaseType === SINGLE_ELIMINATION_FORMAT
          ? await singleEliminationAdvancers(ctx, currentRound._id)
          : await activeRegistrations(ctx, args.tournamentId);
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
      await logAuditEvent(ctx, {
        tournamentId: tournament._id,
        actor: user,
        actorRole: "organizer",
        event: {
          type: "round_started",
          roundId,
          roundNumber: currentRound.roundNumber + 1,
          playerCount: registrations.length,
        },
      });
      return roundId;
    }

    // The phase's configured rounds are done: start the next phase. Round
    // numbering continues across the boundary (day 2 of an 8-round day 1
    // starts at round 9), and passing the finished phase's final round as
    // previousRoundId carries match points, tiebreakers, and pairing history.
    const nextPhase = await phaseByOrder(
      ctx,
      args.tournamentId,
      phase.phaseOrder + 1,
    );
    if (!nextPhase || nextPhase.phaseStatus !== "upcoming") {
      throw new Error("All configured rounds have been generated");
    }
    requirePlayerMeetingStarted(nextPhase);
    let registrations = await activeRegistrations(ctx, args.tournamentId);
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
      await eliminateNonQualifiers(ctx, tournament, registrations);
      roundId = await createSingleEliminationRoundWithPairings(ctx, {
        tournament,
        phase: playablePhase,
        roundNumber: currentRound.roundNumber + 1,
        roundName: "Quarterfinals",
        registrations,
        seededFirstRound: true,
      });
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
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "round_started",
        roundId,
        roundNumber: currentRound.roundNumber + 1,
        playerCount: registrations.length,
      },
    });
    return roundId;
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
    // The round's own phase, not the tournament's current one — the two can
    // differ, and standings must be computed against the phase being played.
    const phase = await requirePhase(ctx, round.tournamentPhaseId);
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
      );
    }
    const now = Date.now();
    await ctx.db.patch(args.roundId, {
      roundStatus: "completed",
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
    const matches = await roundMatches(ctx, args.roundId);

    // Names come from the denormalized copy on each match-player row; only rows
    // missing it (legacy data) fall back to a live lookup, keeping this query
    // off the per-row user join that would otherwise blow the read budget.
    return await Promise.all(
      matches.map(async (match) => {
        const players = await Promise.all(
          (await matchPlayers(ctx, match._id)).map(async (player) => ({
            ...player,
            playerName:
              player.playerName ??
              (await registrationDisplayName(ctx, player.playerId)),
          })),
        );
        return { match, players };
      }),
    );
  },
});

export const getPairingsBoard = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phases = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(16);

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

    return {
      tournament,
      phases: phaseBoards,
      nextStep: await pairingsNextStep(ctx, tournament, phaseBoards),
    };
  },
});

export const getStandings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    return await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", args.roundId),
      )
      .take(MAX_TOURNAMENT_PLAYERS);
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
    return await Promise.all(
      standings.map(async (standing) => ({
        standing,
        playerName:
          standing.playerName ??
          (await registrationDisplayName(ctx, standing.playerId)),
      })),
    );
  },
});

async function topEightFromStandings(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);

  const loadedRegistrations = await Promise.all(
    standings.map((standing) => ctx.db.get(standing.playerId)),
  );
  const registrations: Doc<"tournamentRegistrations">[] = [];
  for (const registration of loadedRegistrations) {
    if (
      registration?.status === "active" &&
      registrations.length < SINGLE_ELIMINATION_PLAYERS
    ) {
      registrations.push(registration);
    }
  }
  if (registrations.length === SINGLE_ELIMINATION_PLAYERS) {
    return registrations;
  }
  throw new Error("A top-8 playoff requires at least eight active players");
}

async function eliminateNonQualifiers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  qualifiers: Doc<"tournamentRegistrations">[],
) {
  const qualifierIds = new Set(
    qualifiers.map((registration) => registration._id),
  );
  const active = await activeRegistrations(ctx, tournament._id);
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  for (const registration of active) {
    if (!qualifierIds.has(registration._id)) {
      eliminated.push(registration);
    }
  }
  const now = Date.now();
  await Promise.all([
    ...eliminated.map((registration) =>
      ctx.db.patch(registration._id, {
        status: "eliminated",
        updatedAt: now,
      }),
    ),
    adjustActiveRegistrationCount(ctx, tournament, -eliminated.length, now),
  ]);
}

async function singleEliminationAdvancers(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const matchesWithPlayers = await roundMatchesWithPlayers(ctx, roundId);
  return (await singleEliminationOutcome(ctx, matchesWithPlayers)).advancers;
}

async function singleEliminationOutcome(
  ctx: QueryCtx,
  matchesWithPlayers: RoundMatchWithPlayers[],
) {
  const resultRows: Array<{
    winner: Doc<"tournamentMatchPlayers">;
    loser: Doc<"tournamentMatchPlayers">;
  }> = [];
  const playerIds = new Set<Id<"tournamentRegistrations">>();

  for (const { players } of matchesWithPlayers) {
    if (players.length !== 2) {
      throw new Error("Single-elimination matches require exactly two players");
    }
    const [first, second] = players;
    const firstWins = first.gameWins ?? 0;
    const secondWins = second.gameWins ?? 0;
    if (firstWins === secondWins) {
      throw new Error("Single-elimination matches must have a winner");
    }
    const winner = firstWins > secondWins ? first : second;
    resultRows.push({ winner, loser: winner === first ? second : first });
    playerIds.add(first.playerId);
    playerIds.add(second.playerId);
  }

  const ids = [...playerIds];
  const registrations = await Promise.all(ids.map((id) => ctx.db.get(id)));
  const registrationsById = new Map<
    Id<"tournamentRegistrations">,
    Doc<"tournamentRegistrations">
  >();
  ids.forEach((id, index) => {
    const registration = registrations[index];
    if (registration) {
      registrationsById.set(id, registration);
    }
  });

  const advancers: Doc<"tournamentRegistrations">[] = [];
  for (const { winner: winnerRow, loser: loserRow } of resultRows) {
    const winner = registrationsById.get(winnerRow.playerId);
    if (winner?.status === "active") {
      advancers.push(winner);
      continue;
    }

    // A drop after recording the result is a withdrawal from the bracket, so
    // the opponent advances in that player's place. This also lets the round
    // complete and keeps the next-round field aligned with active players.
    const opponent = registrationsById.get(loserRow.playerId);
    if (opponent?.status !== "active") {
      throw new Error(
        "Single-elimination match has no active player to advance",
      );
    }
    advancers.push(opponent);
  }
  return { advancers, registrationsById };
}

async function eliminateSingleEliminationLosers(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  matchesWithPlayers: RoundMatchWithPlayers[],
) {
  const { advancers, registrationsById } = await singleEliminationOutcome(
    ctx,
    matchesWithPlayers,
  );
  const winnerIds = new Set(advancers.map((registration) => registration._id));
  const eliminatedIds = new Set<Id<"tournamentRegistrations">>();
  for (const { players } of matchesWithPlayers) {
    for (const player of players) {
      if (!winnerIds.has(player.playerId)) {
        eliminatedIds.add(player.playerId);
      }
    }
  }
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  for (const id of eliminatedIds) {
    const registration = registrationsById.get(id);
    if (registration?.status === "active") {
      eliminated.push(registration);
    }
  }
  const now = Date.now();
  await Promise.all([
    ...eliminated.map((registration) =>
      ctx.db.patch(registration._id, {
        status: "eliminated",
        updatedAt: now,
      }),
    ),
    adjustActiveRegistrationCount(ctx, tournament, -eliminated.length, now),
  ]);
}

function singleEliminationRoundName(playerCount: number) {
  if (playerCount === 4) {
    return "Semifinals";
  }
  if (playerCount === 2) {
    return "Finals";
  }
  throw new Error("Unexpected single-elimination bracket size");
}
