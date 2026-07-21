import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_TOURNAMENT_PLAYERS } from "./registrations";

export const SWISS_FORMAT = "swiss";
export const SINGLE_ELIMINATION_FORMAT = "single_elimination";
export const SINGLE_ELIMINATION_PLAYERS = 8;
export const SINGLE_ELIMINATION_ROUNDS = 3;

export type TournamentPhaseInput = {
  phaseOrder: number;
  phaseType?: "swiss" | "single_elimination";
  phaseRoundMode: "dynamic" | "fixed";
  phaseTotalRounds?: number;
  playerMeeting?: boolean;
};

export function defaultSwissRoundCount(playerCount: number) {
  if (playerCount <= 1) {
    return 1;
  }

  return Math.ceil(Math.log2(playerCount));
}

export async function requirePhase(
  ctx: QueryCtx,
  phaseId: Id<"tournamentPhases">,
) {
  const phase = await ctx.db.get(phaseId);
  if (!phase) {
    throw new Error("Tournament phase not found");
  }
  return phase;
}

// All phases in play order (bounded by the 16-phase cap).
export async function phasesInOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(16);
}

export async function phaseByOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  phaseOrder: number,
) {
  const phase = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId).eq("phaseOrder", phaseOrder),
    )
    .unique();
  return phase;
}

export async function swissPhasesInOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return (await phasesInOrder(ctx, tournamentId)).filter(
    (phase) => phase.phaseType === SWISS_FORMAT,
  );
}

export async function swissPhaseByOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  phaseOrder: number,
) {
  const phase = await phaseByOrder(ctx, tournamentId, phaseOrder);
  return phase?.phaseType === SWISS_FORMAT ? phase : null;
}

// The phase play is currently anchored to: the in-progress phase if one
// exists, otherwise the most recently completed phase (its final round stays
// "current" until the next phase starts), otherwise the first upcoming phase.
// Takes phases already in phaseOrder (as phasesInOrder returns them).
export function selectCurrentPhase(phases: Doc<"tournamentPhases">[]) {
  return (
    phases.find((phase) => phase.phaseStatus === "in_progress") ??
    [...phases].reverse().find((phase) => phase.phaseStatus === "completed") ??
    phases.find((phase) => phase.phaseStatus === "upcoming") ??
    null
  );
}

export async function swissPhaseOrNull(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return selectCurrentPhase(await swissPhasesInOrder(ctx, tournamentId));
}

export async function currentPhaseOrNull(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return selectCurrentPhase(await phasesInOrder(ctx, tournamentId));
}

export async function requireCurrentPhase(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await currentPhaseOrNull(ctx, tournamentId);
  if (!phase) {
    throw new Error("Tournament phase is not configured");
  }
  return phase;
}

export async function requireSwissPhase(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await swissPhaseOrNull(ctx, tournamentId);
  if (!phase) {
    throw new Error("Swiss phase is not configured");
  }
  return phase;
}

// A round's 1-based position within its phase. Round numbers are global
// across the tournament (Magic-style: an 8-round day 1 makes day 2 start at
// round 9), so comparisons against a phase's configured round count must use
// the offset from the phase's first round. Accepts a plain shape so it also
// works for a round that hasn't been inserted yet.
export async function roundNumberInPhase(
  ctx: QueryCtx,
  round: Pick<Doc<"tournamentRounds">, "tournamentPhaseId" | "roundNumber">,
) {
  const firstRound = await ctx.db
    .query("tournamentRounds")
    .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
      q.eq("tournamentPhaseId", round.tournamentPhaseId),
    )
    .first();
  return round.roundNumber - (firstRound?.roundNumber ?? round.roundNumber) + 1;
}

// Round numbers are global across a tournament. Within a phase, the previous
// round is the preceding number; across a phase boundary it is the prior
// phase's final round.
export async function previousTournamentRound(
  ctx: QueryCtx,
  round: Doc<"tournamentRounds">,
): Promise<Doc<"tournamentRounds"> | null> {
  const phase = await requirePhase(ctx, round.tournamentPhaseId);
  const samePhaseRound = await ctx.db
    .query("tournamentRounds")
    .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
      q
        .eq("tournamentPhaseId", round.tournamentPhaseId)
        .eq("roundNumber", round.roundNumber - 1),
    )
    .unique();
  if (samePhaseRound || phase.phaseOrder <= 1) {
    return samePhaseRound;
  }

  const previousPhase = await phaseByOrder(
    ctx,
    round.tournamentId,
    phase.phaseOrder - 1,
  );
  // A phase's phaseCurrentRound is its final round once the phase completes.
  return previousPhase?.phaseCurrentRound
    ? await ctx.db.get(previousPhase.phaseCurrentRound)
    : null;
}

// A phase's player-meeting seats in table order (the index sorts by
// tableNumber). Empty when the phase never held a meeting.
export async function meetingSeats(
  ctx: QueryCtx,
  phaseId: Id<"tournamentPhases">,
) {
  return await ctx.db
    .query("playerMeetingSeats")
    .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
      q.eq("tournamentPhaseId", phaseId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

export async function createPhases(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  phases: ReturnType<typeof validPhaseInputs>,
  now: number,
) {
  for (const phase of phases) {
    await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseName: `Phase ${phase.phaseOrder}`,
      phaseType: phase.phaseType,
      phaseOrder: phase.phaseOrder,
      phaseStatus: "upcoming",
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds: phase.phaseTotalRounds,
      phaseCutoff: null,
      powerPairFinalRound: phase.phaseType === SWISS_FORMAT ? true : undefined,
      playerMeeting: phase.playerMeeting,
      updatedAt: now,
    });
  }
}

export async function resolvePhaseTotalRounds(
  ctx: MutationCtx,
  phase: Doc<"tournamentPhases">,
  activePlayerCount: number,
) {
  if (phase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    if (phase.phaseTotalRounds !== SINGLE_ELIMINATION_ROUNDS) {
      await ctx.db.patch(phase._id, {
        phaseRoundMode: "fixed",
        phaseTotalRounds: SINGLE_ELIMINATION_ROUNDS,
        updatedAt: Date.now(),
      });
    }
    return SINGLE_ELIMINATION_ROUNDS;
  }
  if (phase.phaseRoundMode === "fixed") {
    if (phase.phaseTotalRounds === null) {
      throw new Error("Fixed Swiss phase is missing a round count");
    }
    return phase.phaseTotalRounds;
  }

  const phaseTotalRounds = validRoundCount(
    defaultSwissRoundCount(activePlayerCount),
  );
  if (phase.phaseTotalRounds !== phaseTotalRounds) {
    await ctx.db.patch(phase._id, {
      phaseTotalRounds,
      updatedAt: Date.now(),
    });
  }
  return phaseTotalRounds;
}

export function requireResolvedPhaseTotalRounds(
  phase: Doc<"tournamentPhases">,
) {
  if (phase.phaseTotalRounds === null) {
    throw new Error("Phase round count is not resolved");
  }
  return phase.phaseTotalRounds;
}

export function requireDecisiveEliminationResult(
  phase: Doc<"tournamentPhases">,
  playerOneGameWins: number,
  playerTwoGameWins: number,
) {
  if (
    phase.phaseType === SINGLE_ELIMINATION_FORMAT &&
    playerOneGameWins === playerTwoGameWins
  ) {
    throw new Error("Single-elimination matches cannot end in a draw");
  }
}

// A configured player meeting is a backend lifecycle prerequisite, not only a
// UI step. Once the meeting is in progress, pairing the phase's first round is
// what completes it.
export function requirePlayerMeetingStarted(phase: Doc<"tournamentPhases">) {
  if (phase.playerMeeting && phase.playerMeetingStatus === undefined) {
    throw new Error("Player meeting must be started first");
  }
}

export function validRoundCount(value: number) {
  const rounds = Math.trunc(value);
  if (rounds < 1 || rounds > 16) {
    throw new Error("Swiss rounds must be between 1 and 16");
  }
  return rounds;
}

export function validPhaseInputs(phases: TournamentPhaseInput[]) {
  if (phases.length < 1) {
    throw new Error("At least one Swiss phase is required");
  }
  if (phases.length > 16) {
    throw new Error("A tournament can have at most 16 phases");
  }

  return phases.map((phase, index) => {
    const expectedOrder = index + 1;
    if (Math.trunc(phase.phaseOrder) !== expectedOrder) {
      throw new Error("Tournament phases must be ordered starting at 1");
    }
    const phaseType = phase.phaseType ?? SWISS_FORMAT;
    if (index === 0 && phaseType !== SWISS_FORMAT) {
      throw new Error("A single-elimination phase must follow a Swiss phase");
    }
    if (
      phaseType === SINGLE_ELIMINATION_FORMAT &&
      index !== phases.length - 1
    ) {
      throw new Error("Single elimination must be the final phase");
    }
    // Absent-default convention: store true or leave the field off entirely.
    const playerMeeting = phase.playerMeeting === true ? true : undefined;
    if (phaseType === SINGLE_ELIMINATION_FORMAT) {
      if (playerMeeting) {
        throw new Error(
          "Player meetings are not supported for single elimination",
        );
      }
      return {
        phaseOrder: expectedOrder,
        phaseType,
        phaseRoundMode: "fixed" as const,
        phaseTotalRounds: SINGLE_ELIMINATION_ROUNDS,
        playerMeeting: undefined,
      };
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder: expectedOrder,
        phaseType,
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
        playerMeeting,
      };
    }

    return {
      phaseOrder: expectedOrder,
      phaseType,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: validRoundCount(phase.phaseTotalRounds ?? 0),
      playerMeeting,
    };
  });
}
