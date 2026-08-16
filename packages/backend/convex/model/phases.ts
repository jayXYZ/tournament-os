import {
  DEFAULT_BEST_OF,
  gameWinsEntryError,
  isBestOf,
  type BestOf,
} from "@tournament-os/shared/match-structure";
import { MAX_TOURNAMENT_PHASES } from "@tournament-os/shared/tournament-creation-utils";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_TOURNAMENT_PLAYERS } from "./registrations";

export const SWISS_FORMAT = "swiss";
export const SINGLE_ELIMINATION_FORMAT = "single_elimination";

// The cut a phase feeding a playoff falls back to when none is configured
// (CONTEXT.md "Cut": into single elimination the default is a top-N cut).
export const DEFAULT_PLAYOFF_CUT_PLAYER_COUNT = 8;

export const BRACKET_REQUIRES_TWO_PLAYERS =
  "A playoff needs at least two entering players";

// Rounds are capped at 16 per phase; the phase cap is the shared
// MAX_TOURNAMENT_PHASES the creation form also enforces.
export const MAX_ROUNDS = 16;
export { MAX_TOURNAMENT_PHASES };

// A registration plays at most one match per round, so a player's
// tournamentMatchPlayers rows are bounded by the round cap times the phase
// cap. The bound behind every whole-history read for one player.
export const MAX_MATCHES_PER_PLAYER = MAX_ROUNDS * MAX_TOURNAMENT_PHASES;

export type TournamentPhaseCutoffInput =
  | { kind: "top_X_players"; playerCount: number }
  | { kind: "X_points_or_more"; matchPoints: number };

export type TournamentPhaseInput = {
  phaseOrder: number;
  phaseType?: "swiss" | "single_elimination";
  phaseRoundMode: "dynamic" | "fixed";
  phaseTotalRounds?: number;
  bestOf?: number;
  phaseCutoff?: TournamentPhaseCutoffInput | null;
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

// All phases in play order (bounded by the phase cap).
export async function phasesInOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(MAX_TOURNAMENT_PHASES);
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

export type PhaseTimeline = {
  // The phase's first global round number: taken from its real rounds when
  // any exist, otherwise projected from the rounds expected before it. Null
  // when an earlier dynamic phase hasn't resolved its round count — numbering
  // would show values that silently change later.
  startRoundNumber: number | null;
  // How many rounds the phase is expected to hold: its configured total (or
  // its real rounds if they exceed it), a finished phase's actual count, and
  // null for a dynamic phase still running — more rounds may follow.
  plannedRoundCount: number | null;
};

// The tournament's expected round layout, one entry per phase in phase
// order. Round numbers are global across the tournament (a later phase
// continues the numbering), so each phase's start is folded forward through
// the planned counts before it. This is the engine's one statement of that
// math: timeline clients render these numbers instead of re-deriving them.
export function phaseTimelines(
  phaseBoards: Array<{
    phase: Pick<Doc<"tournamentPhases">, "phaseStatus" | "phaseTotalRounds">;
    rounds: Array<Pick<Doc<"tournamentRounds">, "roundNumber">>;
  }>,
): PhaseTimeline[] {
  const timelines: PhaseTimeline[] = [];
  let nextRoundNumber: number | null = 1;
  for (const { phase, rounds } of phaseBoards) {
    const startRoundNumber: number | null =
      rounds.at(0)?.roundNumber ?? nextRoundNumber;
    // A finished phase's round count is final even if its planned total was
    // never resolved.
    const finished =
      phase.phaseStatus === "completed" || phase.phaseStatus === "cancelled";
    const plannedRoundCount =
      phase.phaseTotalRounds !== null
        ? Math.max(phase.phaseTotalRounds, rounds.length)
        : finished
          ? rounds.length
          : null;
    timelines.push({ startRoundNumber, plannedRoundCount });
    nextRoundNumber =
      startRoundNumber === null || plannedRoundCount === null
        ? null
        : startRoundNumber + plannedRoundCount;
  }
  return timelines;
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

// The tournament's latest completed round, or null before any round finishes.
// Later phases only have rounds once earlier ones finish, so walking the
// phases newest-first finds it — including the previous phase's final round
// while a new phase's first round is still being played. This is the single
// definition of "which round counts as latest completed": live standings and
// final profile placements both read it, so the two can never disagree.
export async function latestCompletedRound(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phases = await phasesInOrder(ctx, tournamentId);
  for (const phase of [...phases].reverse()) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .order("desc")
      .take(MAX_ROUNDS);
    const latestCompleted = rounds.find(
      (round) => round.roundStatus === "completed",
    );
    if (latestCompleted) {
      return latestCompleted;
    }
  }
  return null;
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
      bestOf: phase.bestOf,
      phaseCutoff: phase.phaseCutoff,
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
    // The bracket's round count is a property of the field that enters it —
    // one round per halving of the smallest power-of-two bracket that fits —
    // so it resolves at start like a dynamic Swiss phase's. The progression
    // verdict has already refused a one-player field by the time this runs.
    if (activePlayerCount < 2) {
      throw new Error(BRACKET_REQUIRES_TWO_PLAYERS);
    }
    const phaseTotalRounds = Math.ceil(Math.log2(activePlayerCount));
    if (phase.phaseTotalRounds !== phaseTotalRounds) {
      await ctx.db.patch(phase._id, {
        phaseTotalRounds,
        updatedAt: Date.now(),
      });
    }
    return phaseTotalRounds;
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

// The one gate for a reported scoreline: the structure bounds derived from
// the phase's Match Structure, plus the phase-type draw rule — drawn matches
// are always valid in Swiss and never valid in single elimination.
export function requireValidMatchResult(
  phase: Doc<"tournamentPhases">,
  playerOneGameWins: number,
  playerTwoGameWins: number,
  gameDraws = 0,
) {
  const entryError = gameWinsEntryError(
    phase.bestOf,
    playerOneGameWins,
    playerTwoGameWins,
    gameDraws,
  );
  if (entryError !== null) {
    throw new Error(entryError);
  }
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
export function playerMeetingPending(phase: Doc<"tournamentPhases">) {
  return (
    phase.playerMeeting === true && phase.playerMeetingStatus === undefined
  );
}

export function requirePlayerMeetingStarted(phase: Doc<"tournamentPhases">) {
  if (playerMeetingPending(phase)) {
    throw new Error("Player meeting must be started first");
  }
}

export function validBestOf(value: number | undefined): BestOf {
  if (value === undefined) {
    return DEFAULT_BEST_OF;
  }
  if (!isBestOf(value)) {
    throw new Error("Matches must be best of 1, 3, or 5");
  }
  return value;
}

export function validRoundCount(value: number) {
  const rounds = Math.trunc(value);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 16) {
    throw new Error("Swiss rounds must be between 1 and 16");
  }
  return rounds;
}

export function validPhaseCutoff(cutoff: TournamentPhaseCutoffInput) {
  if (cutoff.kind === "top_X_players") {
    const playerCount = Math.trunc(cutoff.playerCount);
    if (
      !Number.isInteger(playerCount) ||
      playerCount < 2 ||
      playerCount > MAX_TOURNAMENT_PLAYERS
    ) {
      throw new Error(
        `A player-count cutoff must keep between 2 and ${MAX_TOURNAMENT_PLAYERS} players`,
      );
    }
    return { kind: cutoff.kind, playerCount };
  }
  const matchPoints = Math.trunc(cutoff.matchPoints);
  if (!Number.isInteger(matchPoints) || matchPoints < 1) {
    throw new Error("A match-point cutoff must require at least 1 point");
  }
  return { kind: cutoff.kind, matchPoints };
}

export function validPhaseInputs(phases: TournamentPhaseInput[]) {
  if (phases.length < 1) {
    throw new Error("At least one phase is required");
  }
  if (phases.length > MAX_TOURNAMENT_PHASES) {
    throw new Error(
      `A tournament can have at most ${MAX_TOURNAMENT_PHASES} phases`,
    );
  }

  return phases.map((phase, index) => {
    const expectedOrder = index + 1;
    if (Math.trunc(phase.phaseOrder) !== expectedOrder) {
      throw new Error("Tournament phases must be ordered starting at 1");
    }
    const phaseType = phase.phaseType ?? SWISS_FORMAT;
    if (
      phaseType === SINGLE_ELIMINATION_FORMAT &&
      index !== phases.length - 1
    ) {
      throw new Error("Single elimination must be the final phase");
    }
    // Absent-default convention: store true or leave the field off entirely.
    const playerMeeting = phase.playerMeeting === true ? true : undefined;
    // A cutoff cuts the field when its phase completes, so it needs a
    // following phase to cut into — of any type (CONTEXT.md "Cut"). Null
    // means no cut: every active player advances. Omitting the field takes
    // the default — no cut between Swiss phases, a top-N cut into the
    // playoff — so only an explicit null sends the whole surviving field
    // into the bracket. Whatever the cut hands the playoff, any entering
    // field of at least two plays: the bracket is the smallest power of two
    // that fits, with first-round byes for the top seeds when the field
    // falls short (CONTEXT.md "Bracket").
    const nextPhaseType =
      index === phases.length - 1
        ? null
        : (phases[index + 1].phaseType ?? SWISS_FORMAT);
    const rawCutoff = phase.phaseCutoff ?? null;
    if (rawCutoff !== null && nextPhaseType === null) {
      throw new Error("A phase cutoff requires a following phase");
    }
    let phaseCutoff = rawCutoff === null ? null : validPhaseCutoff(rawCutoff);
    if (
      nextPhaseType === SINGLE_ELIMINATION_FORMAT &&
      phase.phaseCutoff === undefined
    ) {
      phaseCutoff = {
        kind: "top_X_players",
        playerCount: DEFAULT_PLAYOFF_CUT_PLAYER_COUNT,
      };
    }
    const bestOf = validBestOf(phase.bestOf);
    if (phaseType === SINGLE_ELIMINATION_FORMAT) {
      if (playerMeeting) {
        throw new Error(
          "Player meetings are not supported for single elimination",
        );
      }
      return {
        phaseOrder: expectedOrder,
        phaseType,
        // The bracket's round count is a property of the field that enters
        // it — the previous phase's cut, or the starting roster when the
        // bracket is the first phase — so like a dynamic Swiss phase's it
        // resolves when the phase starts (resolvePhaseTotalRounds).
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
        bestOf,
        phaseCutoff: null,
        playerMeeting: undefined,
      };
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder: expectedOrder,
        phaseType,
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
        bestOf,
        phaseCutoff,
        playerMeeting,
      };
    }

    return {
      phaseOrder: expectedOrder,
      phaseType,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: validRoundCount(phase.phaseTotalRounds ?? 0),
      bestOf,
      phaseCutoff,
      playerMeeting,
    };
  });
}
