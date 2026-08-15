import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAuditEvent } from "./auditLog";
import { deleteResultRevisionsForMatch } from "./matchResults";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import {
  type CutoffPartition,
  activeRegistrationsInRankOrder,
  cutoffPartitionForNextPhase,
  cutoffQualifiers,
} from "./cutoffs";
import { type PairingsNextStep, pairingsNextStep } from "./nextStep";
import {
  buildSingleEliminationPairings,
  createRoundWithPairings,
  createSingleEliminationRoundWithPairings,
  firstPhaseBracketSeedOrder,
} from "./pairing";
import {
  SINGLE_ELIMINATION_FORMAT,
  SWISS_FORMAT,
  phasesInOrder,
  playerMeetingPending,
  previousTournamentRound,
  requirePhase,
  requireResolvedPhaseTotalRounds,
  resolvePhaseTotalRounds,
  roundNumberInPhase,
  selectCurrentPhase,
  swissPhaseByOrder,
} from "./phases";
import {
  eliminateNonQualifiers,
  restoreEliminationsForRewind,
} from "./participation";
import {
  activeRegistrations,
  comparePlayersAlphabetically,
  resolveRegistrationDisplayName,
} from "./registrations";
import {
  eliminateSingleEliminationLosers,
  planSingleEliminationPairings,
  singleEliminationRoundName,
  singleEliminationSeatWinners,
} from "./singleElimination";
import {
  type RoundMatchWithPlayers,
  replaceStandingsForRound,
} from "./standings";
import {
  PAIRINGS_REWIND_RECORDED_RESULT_REASON,
  requireRound,
  requireTournament,
  roundHasRecordedResult,
  roundMatchesWithPlayers,
} from "./tournaments";

// The tournament-progression module: the one place that knows how a
// tournament moves forward (start → play rounds → cut → next phase →
// complete) and backward (rewind). Its interface is the transitions
// themselves plus `analyzeProgression`, the single rulebook both the
// pairings-board read path and every mutation consult — so what the board
// offers and what a mutation accepts can never drift apart.

const TOURNAMENT_NOT_IN_PROGRESS = "Tournament is not in progress";
const MUST_BE_PUBLISHED_FIRST =
  "Tournament must be published before it can start";
const MUST_START_WITH_FIRST_PHASE =
  "Tournament must start with its first phase";
const PLAYER_MEETING_REQUIRED = "Player meeting must be started first";
const AT_LEAST_TWO_PLAYERS = "At least two active players are required";
const CURRENT_ROUND_NOT_FOUND = "Current round not found";
const ROUND_NOT_COMPLETED = "Current round must be completed first";
const ROUND_NOT_IN_PROGRESS = "Current round is not in progress";
const ONLY_CURRENT_ROUND_COMPLETABLE =
  "Only the current round can be completed";
const ALL_RESULTS_REQUIRED =
  "All matches need results before completing the round";
const ALL_ROUNDS_GENERATED = "All configured rounds have been generated";
const NEXT_PHASE_UNPLAYED =
  "The next phase has not been played; generate its first round instead";
const REWIND_REQUIRES_IN_PROGRESS =
  "Only an in-progress tournament can be rewound";
const REWIND_REQUIRES_ACTIVE_ROUND =
  "Only the current active round can be rewound";
// Not a dead end, just not pairable as it stands: completeTournament is
// allowed from this exact state (it runs the same partition), and when
// dropped players still hold places in the field, reinstating one is the
// only move that makes the phase playable — say so instead of leaving the
// organizer to guess.
const CUTOFF_TOO_FEW_QUALIFIERS =
  "The phase cutoff leaves fewer than two qualifying players; complete the tournament instead";
const CUTOFF_TOO_FEW_QUALIFIERS_HELD_PLACES =
  "The phase cutoff leaves fewer than two qualifying players; reinstate a dropped player who still holds a place in the field, or complete the tournament";
const BRACKET_NO_LIVE_PLAYERS =
  "Every remaining bracket player has left the tournament; complete the tournament instead";

export type PhaseBoard = {
  phase: Doc<"tournamentPhases">;
  rounds: Doc<"tournamentRounds">[];
};

// Everything the progression rulebook reads, loaded once per analysis. All
// verdicts and the board's recommended next step derive from this snapshot,
// which is what makes them incapable of disagreeing: there is no second
// place the same question gets answered from fresh reads.
export type ProgressionFacts = {
  tournament: Doc<"tournaments">;
  phases: Doc<"tournamentPhases">[];
  // The phase play is anchored to (selectCurrentPhase) and its current round.
  phase: Doc<"tournamentPhases"> | null;
  round: Doc<"tournamentRounds"> | null;
  // The round's 1-based position within its phase (round numbers are global
  // across the tournament). Non-null whenever `round` is.
  roundInPhase: number | null;
  // Loaded only while the current round is in progress (rewind needs them).
  previousRound: Doc<"tournamentRounds"> | null;
  matchesWithPlayers: RoundMatchWithPlayers[] | null;
  unreportedMatchCount: number;
  currentRoundHasRecordedResult: boolean;
  // Loaded only in the states whose rules read the roster: pre-start, and
  // between rounds when a later phase could start.
  activeRegistrations: Doc<"tournamentRegistrations">[] | null;
  // The completed bracket round's seat winners in table order (departed
  // winners included — their seats advance and the walkover materializes at
  // pairing; see model/singleElimination.ts). Loaded only between bracket
  // rounds, where the next-round verdict and mutation need them; null
  // everywhere else.
  bracketSeatWinners: Doc<"tournamentRegistrations">[] | null;
  // The first later phase still waiting to be played, and whether its entry
  // requirement can be met from the completed round's standings. The cutoff
  // partition is kept so the mutation that applies the cut reuses the walk
  // the verdict already paid for. The shortfall is true when fewer than two
  // players would enter the next phase — one player can pair nothing,
  // whatever the phase's type (a one-player bracket is never played;
  // CONTEXT.md "Bracket").
  nextUpcomingPhase: Doc<"tournamentPhases"> | null;
  laterUpcomingPhases: Doc<"tournamentPhases">[];
  nextPhaseCutoffPartition: CutoffPartition | null;
  nextPhaseEntryShortfall: boolean;
};

// A verdict either allows an action — carrying everything the transition
// needs so it re-derives nothing — or names the reason it is refused, with
// the exact message the mutation throws.
export type ProgressionVerdict<TPayload = Record<never, never>> =
  | ({ allowed: true; reason: null } & TPayload)
  | { allowed: false; reason: string };

export type RewindAvailability = {
  eligible: boolean;
  reason: string | null;
  removedRoundNumber: number | null;
  reopenedRoundNumber: number | null;
};

export type ProgressionActions = {
  startTournament: ProgressionVerdict<{
    phase: Doc<"tournamentPhases">;
    registrations: Doc<"tournamentRegistrations">[];
  }>;
  completeRound: ProgressionVerdict<{
    phase: Doc<"tournamentPhases">;
    round: Doc<"tournamentRounds">;
    matchesWithPlayers: RoundMatchWithPlayers[];
    roundInPhase: number;
  }>;
  generateNextRound: ProgressionVerdict<
    {
      phase: Doc<"tournamentPhases">;
      round: Doc<"tournamentRounds">;
    } & (
      | {
          mode: "continuePhase";
          // Non-null exactly when the phase is single elimination: the seat
          // winners the next round is paired from.
          bracketSeatWinners: Doc<"tournamentRegistrations">[] | null;
        }
      | {
          mode: "startNextPhase";
          nextPhase: Doc<"tournamentPhases">;
          cutoffPartition: CutoffPartition | null;
        }
    )
  >;
  completeTournament: ProgressionVerdict<{
    phase: Doc<"tournamentPhases">;
    skippedPhases: Doc<"tournamentPhases">[];
  }>;
  rewind: RewindAvailability;
};

export type ProgressionAnalysis = {
  facts: ProgressionFacts;
  actions: ProgressionActions;
  nextStep: PairingsNextStep;
  phaseBoards: PhaseBoard[];
};

export async function loadPhaseBoards(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<PhaseBoard[]> {
  const phases = await phasesInOrder(ctx, tournamentId);
  return await Promise.all(
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
}

export async function analyzeProgression(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  prefetched?: { phaseBoards?: PhaseBoard[] },
): Promise<ProgressionAnalysis> {
  const phaseBoards =
    prefetched?.phaseBoards ?? (await loadPhaseBoards(ctx, tournament._id));
  const phases = phaseBoards.map(({ phase }) => phase);
  const phase = selectCurrentPhase(phases);
  const board =
    phaseBoards.find(({ phase: candidate }) => candidate._id === phase?._id) ??
    null;

  let round: Doc<"tournamentRounds"> | null = null;
  let roundInPhase: number | null = null;
  if (phase?.phaseCurrentRound) {
    const fromBoard = board?.rounds.find(
      (candidate) => candidate._id === phase.phaseCurrentRound,
    );
    round = fromBoard ?? (await requireRound(ctx, phase.phaseCurrentRound));
    roundInPhase =
      fromBoard && board
        ? round.roundNumber - board.rounds[0].roundNumber + 1
        : await roundNumberInPhase(ctx, round);
  }

  const matchesWithPlayers =
    round?.roundStatus === "in_progress"
      ? await roundMatchesWithPlayers(ctx, round._id)
      : null;
  const unreportedMatchCount = (matchesWithPlayers ?? []).reduce(
    (count, { match }) =>
      match.matchStatus === "completed" ? count : count + 1,
    0,
  );
  const currentRoundHasRecordedResult =
    matchesWithPlayers !== null && roundHasRecordedResult(matchesWithPlayers);
  const previousRound =
    round?.roundStatus === "in_progress"
      ? await previousTournamentRound(ctx, round)
      : null;

  const laterUpcomingPhases = phase
    ? phases.filter(
        (candidate) =>
          candidate.phaseOrder > phase.phaseOrder &&
          candidate.phaseStatus === "upcoming",
      )
    : [];
  const nextUpcomingPhase = laterUpcomingPhases.at(0) ?? null;

  const registrations =
    tournament.lifecycle === "registration" ||
    (round?.roundStatus === "completed" && nextUpcomingPhase !== null)
      ? await activeRegistrations(ctx, tournament._id)
      : null;

  // Between bracket rounds the rulebook needs the completed round's seat
  // winners: the next round is paired from them, and a bracket whose every
  // remaining seat-holder has left cannot be paired at all.
  const bracketSeatWinners =
    round?.roundStatus === "completed" &&
    phase?.phaseType === SINGLE_ELIMINATION_FORMAT &&
    phase.phaseTotalRounds !== null &&
    (roundInPhase ?? 1) < phase.phaseTotalRounds
      ? await singleEliminationSeatWinners(ctx, round._id)
      : null;

  // Whether the next phase's entry requirement can be met from the completed
  // round's standings. The finished phase's configured cutoff decides who
  // enters — whatever the next phase's type — and any phase type can play
  // any entering field of at least two: a bracket sizes itself to the field
  // with byes for the top seeds when it falls short. One computation feeds
  // the board's completeTournament offer, generateNextRound's refusal, and
  // completeTournament's skip-unplayable-phase permission.
  let nextPhaseCutoffPartition: CutoffPartition | null = null;
  let nextPhaseEntryShortfall = false;
  if (round?.roundStatus === "completed" && phase && nextUpcomingPhase) {
    if (phase.phaseCutoff !== null) {
      nextPhaseCutoffPartition = await cutoffPartitionForNextPhase(
        ctx,
        round._id,
        phase.phaseCutoff,
        nextUpcomingPhase,
      );
    }
    const enteringPlayerCount =
      nextPhaseCutoffPartition?.qualifiers.length ?? registrations?.length ?? 0;
    nextPhaseEntryShortfall = enteringPlayerCount < 2;
  }

  const facts: ProgressionFacts = {
    tournament,
    phases,
    phase,
    round,
    roundInPhase,
    previousRound,
    matchesWithPlayers,
    unreportedMatchCount,
    currentRoundHasRecordedResult,
    activeRegistrations: registrations,
    bracketSeatWinners,
    nextUpcomingPhase,
    laterUpcomingPhases,
    nextPhaseCutoffPartition,
    nextPhaseEntryShortfall,
  };
  const actions = deriveProgressionActions(facts);
  return {
    facts,
    actions,
    nextStep: pairingsNextStep(facts, actions),
    phaseBoards,
  };
}

function disallowed(reason: string): { allowed: false; reason: string } {
  return { allowed: false, reason };
}

function deriveProgressionActions(facts: ProgressionFacts): ProgressionActions {
  return {
    startTournament: startTournamentVerdict(facts),
    completeRound: completeRoundVerdict(facts),
    generateNextRound: generateNextRoundVerdict(facts),
    completeTournament: completeTournamentVerdict(facts),
    rewind: rewindAvailability(facts),
  };
}

function startTournamentVerdict(
  facts: ProgressionFacts,
): ProgressionActions["startTournament"] {
  const { tournament, phase } = facts;
  if (tournament.lifecycle !== "registration") {
    return disallowed(MUST_BE_PUBLISHED_FIRST);
  }
  if (!phase) {
    return disallowed("Tournament phase is not configured");
  }
  // Defensive: pre-start the current phase is the first upcoming one, so a
  // later phase here means the phase records are inconsistent. Any phase
  // type may open the tournament — a first-phase bracket seeds from the
  // tournament's random seed (CONTEXT.md "Bracket").
  if (phase.phaseOrder !== 1) {
    return disallowed(MUST_START_WITH_FIRST_PHASE);
  }
  const registrations = facts.activeRegistrations ?? [];
  if (playerMeetingPending(phase)) {
    return disallowed(PLAYER_MEETING_REQUIRED);
  }
  if (registrations.length < 2) {
    return disallowed(AT_LEAST_TWO_PLAYERS);
  }
  return { allowed: true, reason: null, phase, registrations };
}

function completeRoundVerdict(
  facts: ProgressionFacts,
): ProgressionActions["completeRound"] {
  const { tournament, phase, round } = facts;
  if (tournament.lifecycle !== "in_progress") {
    return disallowed(TOURNAMENT_NOT_IN_PROGRESS);
  }
  if (!phase || !round) {
    return disallowed(ONLY_CURRENT_ROUND_COMPLETABLE);
  }
  if (round.roundStatus !== "in_progress") {
    return disallowed(ROUND_NOT_IN_PROGRESS);
  }
  if (facts.unreportedMatchCount > 0) {
    return disallowed(ALL_RESULTS_REQUIRED);
  }
  return {
    allowed: true,
    reason: null,
    phase,
    round,
    matchesWithPlayers: facts.matchesWithPlayers ?? [],
    roundInPhase: facts.roundInPhase ?? 1,
  };
}

function generateNextRoundVerdict(
  facts: ProgressionFacts,
): ProgressionActions["generateNextRound"] {
  const { tournament, phase, round } = facts;
  if (tournament.lifecycle !== "in_progress") {
    return disallowed(TOURNAMENT_NOT_IN_PROGRESS);
  }
  if (!phase || !round) {
    return disallowed(CURRENT_ROUND_NOT_FOUND);
  }
  if (round.roundStatus !== "completed") {
    return disallowed(ROUND_NOT_COMPLETED);
  }
  if (
    phase.phaseTotalRounds === null ||
    (facts.roundInPhase ?? 1) < phase.phaseTotalRounds
  ) {
    // A bracket round is paired from the completed round's seat winners.
    // When every one of them has left the tournament, chained walkovers have
    // no one left to award — the bracket is over, whatever its configured
    // round count says.
    if (
      facts.bracketSeatWinners !== null &&
      !facts.bracketSeatWinners.some(
        (registration) => registration.participationStatus === "active",
      )
    ) {
      return disallowed(BRACKET_NO_LIVE_PLAYERS);
    }
    return {
      allowed: true,
      reason: null,
      phase,
      round,
      mode: "continuePhase",
      bracketSeatWinners: facts.bracketSeatWinners,
    };
  }

  const nextPhase = facts.nextUpcomingPhase;
  if (!nextPhase) {
    return disallowed(ALL_ROUNDS_GENERATED);
  }
  if (playerMeetingPending(nextPhase)) {
    return disallowed(PLAYER_MEETING_REQUIRED);
  }
  if (facts.nextPhaseEntryShortfall) {
    // With no cut configured the shortfall is a plain thin field; with one,
    // the cut is what left the phase short, and held places name the one
    // recovery move besides completion.
    if (facts.nextPhaseCutoffPartition === null) {
      return disallowed(AT_LEAST_TWO_PLAYERS);
    }
    return disallowed(
      facts.nextPhaseCutoffPartition.heldPlaces.length > 0
        ? CUTOFF_TOO_FEW_QUALIFIERS_HELD_PLACES
        : CUTOFF_TOO_FEW_QUALIFIERS,
    );
  }
  return {
    allowed: true,
    reason: null,
    phase,
    round,
    mode: "startNextPhase",
    nextPhase,
    cutoffPartition: facts.nextPhaseCutoffPartition,
  };
}

function completeTournamentVerdict(
  facts: ProgressionFacts,
): ProgressionActions["completeTournament"] {
  const { tournament, phase, round } = facts;
  if (tournament.lifecycle !== "in_progress") {
    return disallowed(TOURNAMENT_NOT_IN_PROGRESS);
  }
  if (!phase || !round) {
    return disallowed(CURRENT_ROUND_NOT_FOUND);
  }
  if (round.roundStatus !== "completed") {
    return disallowed(ROUND_NOT_COMPLETED);
  }
  // Between phases the current phase is already "completed" and its final
  // round has been played, so the checks above pass. Without this guard the
  // tournament could be marked completed while a playable later phase is
  // still upcoming, permanently stranding it. An unplayable next phase may
  // be skipped: one left with fewer than two entering players, whatever its
  // type. Phases after it are unplayable too — nobody advances through a
  // skipped phase — so they are all cancelled when the skip happens.
  if (facts.nextUpcomingPhase && !facts.nextPhaseEntryShortfall) {
    return disallowed(NEXT_PHASE_UNPLAYED);
  }
  return {
    allowed: true,
    reason: null,
    phase,
    skippedPhases: facts.laterUpcomingPhases,
  };
}

function rewindAvailability(facts: ProgressionFacts): RewindAvailability {
  const { tournament, round } = facts;
  if (tournament.lifecycle !== "in_progress") {
    return {
      eligible: false,
      reason: REWIND_REQUIRES_IN_PROGRESS,
      removedRoundNumber: null,
      reopenedRoundNumber: null,
    };
  }
  if (!round || round.roundStatus !== "in_progress") {
    return {
      eligible: false,
      reason: REWIND_REQUIRES_ACTIVE_ROUND,
      removedRoundNumber: round?.roundNumber ?? null,
      reopenedRoundNumber: null,
    };
  }
  const hasResult = facts.currentRoundHasRecordedResult;
  return {
    eligible: !hasResult,
    reason: hasResult ? PAIRINGS_REWIND_RECORDED_RESULT_REASON : null,
    removedRoundNumber: round.roundNumber,
    reopenedRoundNumber: facts.previousRound?.roundNumber ?? null,
  };
}

function requireAllowed<TPayload>(
  verdict: ProgressionVerdict<TPayload>,
): asserts verdict is { allowed: true; reason: null } & TPayload {
  if (!verdict.allowed) {
    throw new Error(verdict.reason);
  }
}

type ProgressionActor = {
  tournament: Doc<"tournaments">;
  user: Doc<"users">;
};

export async function startTournament(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
): Promise<Id<"tournamentRounds">> {
  const { actions } = await analyzeProgression(ctx, tournament);
  requireAllowed(actions.startTournament);
  const { phase, registrations } = actions.startTournament;

  const roundId = await pairFirstRoundOfTournament(ctx, {
    tournament,
    phase,
    registrations,
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
}

// The shared start sequence: resolve the phase's round count, pair round 1,
// and move tournament and phase into play. Also used by test seeding
// (createTestTournament's autoStart), which deliberately skips the
// startTournament gate and audit trail — the sequence is what must not fork.
export async function pairFirstRoundOfTournament(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    registrations: Doc<"tournamentRegistrations">[];
  },
): Promise<Id<"tournamentRounds">> {
  const { tournament, phase, registrations } = args;
  const phaseTotalRounds = await resolvePhaseTotalRounds(
    ctx,
    phase,
    registrations.length,
  );
  const playablePhase = { ...phase, phaseTotalRounds };

  const roundId =
    phase.phaseType === SINGLE_ELIMINATION_FORMAT
      ? await createSingleEliminationRoundWithPairings(ctx, {
          tournament,
          phase: playablePhase,
          roundNumber: 1,
          // No standings precede a first-phase bracket, so the tournament's
          // random seed orders the field (CONTEXT.md "Bracket"). The phase's
          // first round has every resolved round still to play, which names
          // its stage.
          roundName: singleEliminationRoundName(phaseTotalRounds),
          pairings: buildSingleEliminationPairings(
            firstPhaseBracketSeedOrder(registrations),
          ),
        })
      : await createRoundWithPairings(ctx, {
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
    // Pairing round 1 ends any live player meeting, and re-completes a
    // snapshot a round-1 rewind had stamped "superseded". Keyed on the
    // status, not the setting, so a meeting started before the flag was
    // frozen still closes cleanly.
    ...(phase.playerMeetingStatus !== undefined
      ? { playerMeetingStatus: "completed" as const }
      : {}),
    updatedAt: now,
  });
  return roundId;
}

export async function publishPairings(
  ctx: MutationCtx,
  roundId: Id<"tournamentRounds">,
): Promise<Id<"tournamentRounds">> {
  const round = await requireRound(ctx, roundId);
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
}

export async function completeRound(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
  roundId: Id<"tournamentRounds">,
): Promise<Id<"tournamentRounds">> {
  const round = await requireRound(ctx, roundId);
  const { facts, actions } = await analyzeProgression(ctx, tournament);
  if (facts.round?._id !== round._id) {
    throw new Error(
      tournament.lifecycle !== "in_progress"
        ? TOURNAMENT_NOT_IN_PROGRESS
        : ONLY_CURRENT_ROUND_COMPLETABLE,
    );
  }
  requireAllowed(actions.completeRound);
  return await executeCompleteRound(
    ctx,
    tournament,
    user,
    actions.completeRound,
  );
}

async function executeCompleteRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  user: Doc<"users">,
  step: {
    phase: Doc<"tournamentPhases">;
    round: Doc<"tournamentRounds">;
    matchesWithPlayers: RoundMatchWithPlayers[];
    roundInPhase: number;
  },
): Promise<Id<"tournamentRounds">> {
  const { phase, round, matchesWithPlayers, roundInPhase } = step;
  await replaceStandingsForRound(
    ctx,
    tournament,
    phase,
    round,
    matchesWithPlayers,
  );
  if (phase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    // The rewrite above just made this the latest completed round, which is
    // where the elimination batch lands its standings-status repair.
    await eliminateSingleEliminationLosers(ctx, round, matchesWithPlayers);
  }
  const now = Date.now();
  await ctx.db.patch(round._id, {
    roundStatus: "completed",
    // A completed round is part of the public tournament record. Publishing
    // here prevents organizer-entered results from becoming permanently
    // hidden once phaseCurrentRound advances past an unpublished round.
    pairingsPublishedAt: round.pairingsPublishedAt ?? now,
    updatedAt: now,
  });
  // The round is over, so its timer is too (patching undefined removes it).
  if (tournament.roundTimer?.roundId === round._id) {
    await ctx.db.patch(tournament._id, {
      roundTimer: undefined,
      updatedAt: now,
    });
  }
  if (roundInPhase >= requireResolvedPhaseTotalRounds(phase)) {
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
      roundId: round._id,
      roundNumber: round.roundNumber,
    },
  });
  return round._id;
}

export async function generateNextRound(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
): Promise<Id<"tournamentRounds">> {
  const { actions } = await analyzeProgression(ctx, tournament);
  requireAllowed(actions.generateNextRound);
  return await executeGenerateNextRound(
    ctx,
    tournament,
    user,
    actions.generateNextRound,
  );
}

async function executeGenerateNextRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  user: Doc<"users">,
  step: Extract<ProgressionActions["generateNextRound"], { allowed: true }>,
): Promise<Id<"tournamentRounds">> {
  // Defensive: completeRound clears the finished round's timer, so this only
  // fires if a stale timer somehow survived; the new round starts without one.
  if (tournament.roundTimer) {
    await ctx.db.patch(tournament._id, {
      roundTimer: undefined,
      updatedAt: Date.now(),
    });
  }
  const { roundId, playerCount } =
    step.mode === "continuePhase"
      ? await continuePhaseWithNextRound(ctx, tournament, step)
      : await startNextPhaseFirstRound(ctx, tournament, step);
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "round_started",
      roundId,
      roundNumber: step.round.roundNumber + 1,
      playerCount,
    },
  });
  return roundId;
}

async function continuePhaseWithNextRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  step: Extract<
    ProgressionActions["generateNextRound"],
    { allowed: true; mode: "continuePhase" }
  >,
) {
  const { phase, round: currentRound } = step;
  let roundId: Id<"tournamentRounds">;
  let playerCount: number;
  if (phase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    // The verdict that allowed this step loaded the seat winners and proved
    // at least one is still live, so the plan below has a match to create.
    const seatWinners =
      step.bracketSeatWinners ??
      (await singleEliminationSeatWinners(ctx, currentRound._id));
    const pairings = planSingleEliminationPairings(seatWinners);
    // The name comes from the new round's structural position, so a bracket
    // thinned by chained walkovers keeps its stage names.
    const newRoundInPhase = await roundNumberInPhase(ctx, {
      tournamentPhaseId: phase._id,
      roundNumber: currentRound.roundNumber + 1,
    });
    const roundsRemaining =
      requireResolvedPhaseTotalRounds(phase) - newRoundInPhase + 1;
    roundId = await createSingleEliminationRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: currentRound.roundNumber + 1,
      roundName: singleEliminationRoundName(roundsRemaining),
      pairings,
    });
    playerCount = pairings.reduce(
      (count, pairing) => count + (pairing.isBye ? 1 : 2),
      0,
    );
  } else {
    const registrations = await activeRegistrations(ctx, tournament._id);
    roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: currentRound.roundNumber + 1,
      registrations,
      previousRoundId: currentRound._id,
    });
    playerCount = registrations.length;
  }
  await ctx.db.patch(phase._id, {
    phaseCurrentRound: roundId,
    updatedAt: Date.now(),
  });
  return { roundId, playerCount };
}

// The phase's configured rounds are done: start the next phase. Round
// numbering continues across the boundary (day 2 of an 8-round day 1
// starts at round 9), and passing the finished phase's final round as
// previousRoundId carries match points, tiebreakers, and pairing history.
async function startNextPhaseFirstRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  step: {
    phase: Doc<"tournamentPhases">;
    round: Doc<"tournamentRounds">;
    nextPhase: Doc<"tournamentPhases">;
    cutoffPartition: CutoffPartition | null;
  },
) {
  const { phase, round: currentRound, nextPhase } = step;
  // Who enters the next phase: the finished phase's configured cutoff —
  // whatever the next phase's type (CONTEXT.md "Cut") — otherwise every
  // active player. One partition supplies both the qualifiers and the
  // dropped players who keep an elimination record (see
  // eliminateNonQualifiers), so the two sides of the cut can never disagree
  // about where the boundary sits. The verdict that allowed this step
  // already proved the entering field can play the phase.
  let registrations: Doc<"tournamentRegistrations">[];
  let appliedCut: CutoffPartition | null = null;
  if (phase.phaseCutoff !== null) {
    appliedCut =
      step.cutoffPartition ??
      (await cutoffPartitionForNextPhase(
        ctx,
        currentRound._id,
        phase.phaseCutoff,
        nextPhase,
      ));
    registrations = appliedCut.qualifiers;
  } else if (nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    // No cut, but a bracket seeds from the finished phase's final standings,
    // so the whole advancing field must arrive in rank order — a Swiss next
    // phase re-pairs from scratch and takes the roster as-is below.
    registrations = await activeRegistrationsInRankOrder(
      ctx,
      tournament._id,
      currentRound._id,
    );
  } else {
    registrations = await activeRegistrations(ctx, tournament._id);
  }
  const nextPhaseTotalRounds = await resolvePhaseTotalRounds(
    ctx,
    nextPhase,
    registrations.length,
  );
  const playablePhase = {
    ...nextPhase,
    phaseTotalRounds: nextPhaseTotalRounds,
  };

  const roundId =
    nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT
      ? await createSingleEliminationRoundWithPairings(ctx, {
          tournament,
          phase: playablePhase,
          roundNumber: currentRound.roundNumber + 1,
          // The qualifiers arrive in standings rank order, which is the
          // bracket seeding order. The phase's first round has every
          // resolved round still to play, which names its stage.
          roundName: singleEliminationRoundName(nextPhaseTotalRounds),
          pairings: buildSingleEliminationPairings(registrations),
        })
      : await createRoundWithPairings(ctx, {
          tournament,
          phase: playablePhase,
          roundNumber: currentRound.roundNumber + 1,
          registrations,
          previousRoundId: currentRound._id,
        });
  if (appliedCut !== null) {
    // The cut belongs to the completed round whose standings produced it.
    // Rewinding the next phase's first round reopens that round and should
    // restore the cut; rewinding a later bracket round must restore only
    // bracket losers.
    await eliminateNonQualifiers(ctx, tournament, appliedCut, currentRound._id);
  }
  await ctx.db.patch(nextPhase._id, {
    phaseStatus: "in_progress",
    phaseCurrentRound: roundId,
    // Pairing the phase's first round ends any live player meeting, and a
    // "superseded" snapshot the cut above just consumed goes back to
    // "completed" so a later rewind can supersede it again.
    ...(nextPhase.playerMeetingStatus !== undefined
      ? { playerMeetingStatus: "completed" as const }
      : {}),
    updatedAt: Date.now(),
  });
  return { roundId, playerCount: registrations.length };
}

export async function completeTournament(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
): Promise<void> {
  const { actions } = await analyzeProgression(ctx, tournament);
  requireAllowed(actions.completeTournament);
  await executeCompleteTournament(
    ctx,
    tournament,
    user,
    actions.completeTournament,
  );
}

async function executeCompleteTournament(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  user: Doc<"users">,
  step: {
    phase: Doc<"tournamentPhases">;
    skippedPhases: Doc<"tournamentPhases">[];
  },
): Promise<void> {
  for (const upcomingPhase of step.skippedPhases) {
    await ctx.db.patch(upcomingPhase._id, {
      phaseStatus: "cancelled",
      updatedAt: Date.now(),
    });
  }
  const now = Date.now();
  await ctx.db.patch(step.phase._id, {
    phaseStatus: "completed",
    updatedAt: now,
  });
  await ctx.db.patch(tournament._id, {
    lifecycle: "completed",
    updatedAt: now,
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: { type: "tournament_completed" },
  });
}

export type AdvanceOutcome =
  | {
      kind: "nextRoundPaired";
      completedRoundId: Id<"tournamentRounds">;
      nextRoundId: Id<"tournamentRounds">;
    }
  | { kind: "tournamentCompleted"; completedRoundId: Id<"tournamentRounds"> };

// Drive the tournament forward one full round: complete the current round,
// then pair the next one or complete the tournament — whichever the rulebook
// allows. `completeTournamentAfterRound` ends the event early once the round
// with that (tournament-global) number has been completed, which is how the
// test shortcut honors its configured round budget.
export async function advance(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
  options?: { completeTournamentAfterRound?: number },
): Promise<AdvanceOutcome> {
  const first = await analyzeProgression(ctx, tournament);
  requireAllowed(first.actions.completeRound);
  const completedRound = first.actions.completeRound.round;
  await executeCompleteRound(
    ctx,
    tournament,
    user,
    first.actions.completeRound,
  );

  // Completing the round moved the state machine; every doc the next step
  // reads is re-fetched so the second verdict sees what the first one wrote.
  const freshTournament = await requireTournament(ctx, tournament._id);
  const next = await analyzeProgression(ctx, freshTournament);

  const stopAfter = options?.completeTournamentAfterRound;
  if (stopAfter !== undefined && completedRound.roundNumber >= stopAfter) {
    requireAllowed(next.actions.completeTournament);
    await executeCompleteTournament(
      ctx,
      freshTournament,
      user,
      next.actions.completeTournament,
    );
    return {
      kind: "tournamentCompleted",
      completedRoundId: completedRound._id,
    };
  }
  if (!next.actions.generateNextRound.allowed) {
    if (next.actions.completeTournament.allowed) {
      await executeCompleteTournament(
        ctx,
        freshTournament,
        user,
        next.actions.completeTournament,
      );
      return {
        kind: "tournamentCompleted",
        completedRoundId: completedRound._id,
      };
    }
    throw new Error(next.actions.generateNextRound.reason);
  }
  const nextRoundId = await executeGenerateNextRound(
    ctx,
    freshTournament,
    user,
    next.actions.generateNextRound,
  );
  return {
    kind: "nextRoundPaired",
    completedRoundId: completedRound._id,
    nextRoundId,
  };
}

export async function rewindLatestRound(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
): Promise<Id<"tournamentRounds"> | null> {
  const { facts, actions } = await analyzeProgression(ctx, tournament);
  if (!actions.rewind.eligible) {
    // The board folds "no current round" into the active-round reason; the
    // mutation keeps the more precise message.
    if (tournament.lifecycle === "in_progress" && !facts.round) {
      throw new Error(CURRENT_ROUND_NOT_FOUND);
    }
    throw new Error(actions.rewind.reason ?? REWIND_REQUIRES_ACTIVE_ROUND);
  }
  const phase = facts.phase;
  const round = facts.round;
  if (!phase || !round) {
    throw new Error(CURRENT_ROUND_NOT_FOUND);
  }
  const matchesWithPlayers = facts.matchesWithPlayers ?? [];
  const previousRound = facts.previousRound;
  const now = Date.now();
  // One operation owns the whole participation unwind — restoring the
  // eliminations these rounds recorded, deleting the reopened round's
  // standings, and repairing the round that promotes to latest completed —
  // so no ordering constraint between those steps leaks out here.
  await restoreEliminationsForRewind(ctx, tournament, {
    removedRound: round,
    reopenedRound: previousRound,
  });

  for (const { match, players } of matchesWithPlayers) {
    for (const player of players) {
      await ctx.db.delete(player._id);
    }
    await deleteResultRevisionsForMatch(ctx, match._id);
    await ctx.db.delete(match._id);
  }
  await ctx.db.delete(round._id);

  if (previousRound) {
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
      // Unwinding the phase's start. The meeting really happened and its
      // seats stay on disk, but the standings they were drawn from are
      // being deleted a few lines up, so the snapshot no longer proves who
      // belongs in the field. Stamp it "superseded" — the explicit marker
      // cutoffPartitionForNextPhase reads to re-draw the cut boundary from
      // the corrected standings instead of taking the seats verbatim.
      // Re-pairing the phase's first round stamps it back to "completed".
      await ctx.db.patch(phase._id, {
        phaseStatus: "upcoming",
        phaseCurrentRound: undefined,
        ...(phase.playerMeetingStatus === "completed"
          ? { playerMeetingStatus: "superseded" as const }
          : {}),
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
      // Same supersede stamp as the cross-phase unwind above. No cut ever
      // reads an order-1 phase, but the stamp keeps the state machine
      // uniform: "completed" always means the phase's first round is
      // paired, and startTournament re-completes the snapshot when round 1
      // is paired again.
      ...(phase.playerMeetingStatus === "completed"
        ? { playerMeetingStatus: "superseded" as const }
        : {}),
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
}

// Seats the phase's player pool for its player meeting: alphabetical order,
// two per table (players 1&2 at table 1, 3&4 at table 2, an odd player alone
// at the last table). The pool is every active player, unless the previous
// phase configured a cutoff — then only its qualifiers are seated, matching
// the cut startNextPhaseFirstRound applies when round 1 is paired. That cutoff
// meeting snapshot remains authoritative through pairing, while live status
// still removes dropped qualifiers. Attendance drops happen through the normal
// dropRegistration flow and readers live-join registration status, so seat
// rows are never rewritten.
export async function startPlayerMeeting(
  ctx: MutationCtx,
  { tournament, user }: ProgressionActor,
  phase: Doc<"tournamentPhases">,
): Promise<Id<"tournamentPhases">> {
  if (
    tournament.lifecycle === "completed" ||
    tournament.lifecycle === "cancelled"
  ) {
    throw new Error("Tournament is no longer running");
  }
  if (phase.phaseType !== SWISS_FORMAT) {
    throw new Error("Phase is not a Swiss phase");
  }
  if (phase.phaseStatus !== "upcoming") {
    throw new Error("Phase has already started");
  }
  if (phase.playerMeeting !== true) {
    throw new Error("Player meeting is not enabled for this phase");
  }
  if (phase.playerMeetingStatus !== undefined) {
    throw new Error("Player meeting has already started");
  }
  let registrations: Doc<"tournamentRegistrations">[];
  if (phase.phaseOrder === 1) {
    if (tournament.lifecycle !== "registration") {
      throw new Error("Tournament must be published before the meeting starts");
    }
    registrations = await activeRegistrations(ctx, tournament._id);
  } else {
    if (tournament.lifecycle !== "in_progress") {
      throw new Error(TOURNAMENT_NOT_IN_PROGRESS);
    }
    const previousPhase = await swissPhaseByOrder(
      ctx,
      tournament._id,
      phase.phaseOrder - 1,
    );
    if (previousPhase?.phaseStatus !== "completed") {
      throw new Error("Previous phase must be completed first");
    }
    // The cut is enforced on registrations only when round 1 is paired, but
    // the meeting freezes its entry field from the previous phase's final
    // standings — seat only the players who made it.
    if (previousPhase.phaseCutoff !== null) {
      if (!previousPhase.phaseCurrentRound) {
        throw new Error("Previous phase's final round not found");
      }
      registrations = await cutoffQualifiers(
        ctx,
        tournament._id,
        previousPhase.phaseCurrentRound,
        previousPhase.phaseCutoff,
      );
      if (registrations.length < 2) {
        throw new Error(
          "The phase cutoff leaves fewer than two qualifying players",
        );
      }
    } else {
      registrations = await activeRegistrations(ctx, tournament._id);
    }
  }
  if (registrations.length < 2) {
    throw new Error(AT_LEAST_TWO_PLAYERS);
  }

  const players = await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) => ({
      registrationId: registration._id,
      playerName:
        (await resolveRegistrationDisplayName(
          ctx,
          registration.playerName,
          registration._id,
        )) ?? null,
      createdAt: registration.createdAt,
    }),
  );
  players.sort(comparePlayersAlphabetically);

  const now = Date.now();
  for (const [index, player] of players.entries()) {
    await ctx.db.insert("playerMeetingSeats", {
      tournamentId: tournament._id,
      tournamentPhaseId: phase._id,
      registrationId: player.registrationId,
      playerName: player.playerName,
      tableNumber: Math.floor(index / 2) + 1,
      updatedAt: now,
    });
  }
  await ctx.db.patch(phase._id, {
    playerMeetingStatus: "in_progress",
    updatedAt: now,
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "player_meeting_started",
      phaseOrder: phase.phaseOrder,
      playerCount: players.length,
    },
  });
  return phase._id;
}
