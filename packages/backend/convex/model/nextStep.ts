import type { Id } from "../_generated/dataModel";
import { SINGLE_ELIMINATION_PLAYERS, playerMeetingPending } from "./phases";
import { isPairingsVisibleToPlayers } from "./tournaments";
import type { ProgressionActions, ProgressionFacts } from "./progression";

export type PairingsNextStep =
  | { kind: "publishTournament"; ready: boolean; reason: string | null }
  | {
      kind: "startPlayerMeeting";
      ready: boolean;
      reason: string | null;
      phaseId: Id<"tournamentPhases">;
    }
  | { kind: "startTournament"; ready: boolean; reason: string | null }
  | {
      kind: "publishPairings";
      ready: boolean;
      reason: string | null;
      roundId: Id<"tournamentRounds">;
    }
  | { kind: "startTimer"; ready: boolean; reason: string | null }
  | {
      kind: "completeRound";
      ready: boolean;
      reason: string | null;
      roundId: Id<"tournamentRounds">;
    }
  | { kind: "generateNextRound"; ready: boolean; reason: string | null }
  | { kind: "completeTournament"; ready: boolean; reason: string | null }
  | { kind: "tournamentCompleted" }
  | { kind: "tournamentCancelled" };

// The organizer board's single recommended step, projected from the
// progression rulebook (model/progression.ts). This function performs no
// reads and re-derives no readiness rules: everything it branches on was
// computed once by analyzeProgression — the same facts and verdicts the
// mutations enforce — so the board can never disagree with what a mutation
// would accept. What it adds is presentation only: which allowed action to
// surface first, and reason strings phrased for the board (e.g. the
// unreported-match count) rather than for a thrown error.
export function pairingsNextStep(
  facts: ProgressionFacts,
  actions: ProgressionActions,
): PairingsNextStep {
  const { tournament, phase, round } = facts;
  if (tournament.lifecycle === "cancelled") {
    return { kind: "tournamentCancelled" };
  }
  if (tournament.lifecycle === "completed") {
    return { kind: "tournamentCompleted" };
  }

  if (tournament.lifecycle === "setup") {
    return {
      kind: "publishTournament",
      ready: facts.hasSwissPhase,
      reason: facts.hasSwissPhase ? null : "Swiss phase is not configured",
    };
  }

  if (tournament.lifecycle !== "in_progress") {
    if (!phase) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "Tournament phase is not configured",
      };
    }
    const registrationCount = facts.activeRegistrations?.length ?? 0;
    if (
      facts.hasUpcomingTopEightPlayoff &&
      registrationCount < SINGLE_ELIMINATION_PLAYERS
    ) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "A top-8 playoff requires at least eight active players",
      };
    }
    // The meeting is offered exactly once: after it starts (or completes) the
    // flag no longer matters and play falls through to startTournament, which
    // closes an in-progress meeting itself.
    if (playerMeetingPending(phase)) {
      return startPlayerMeetingStep(phase._id, registrationCount);
    }
    return {
      kind: "startTournament",
      ready: actions.startTournament.allowed,
      reason: actions.startTournament.reason,
    };
  }

  if (!phase || !round) {
    return {
      kind: "startTournament",
      ready: false,
      reason: "Current round not found",
    };
  }

  if (!isPairingsVisibleToPlayers(round)) {
    return {
      kind: "publishPairings",
      ready: true,
      reason: null,
      roundId: round._id,
    };
  }
  if (round.roundStatus !== "completed") {
    // Once every match has a result, completing the round and posting standings
    // is the next step regardless of the timer (a round can finish without one
    // ever being started).
    if (facts.unreportedMatchCount === 0) {
      return {
        kind: "completeRound",
        ready: true,
        reason: null,
        roundId: round._id,
      };
    }
    // The round is being played but its timer was never started (or was
    // reset): starting it is the next step, so the organizer can do it from
    // anywhere and is reminded it exists.
    if (tournament.roundTimer?.roundId !== round._id) {
      return { kind: "startTimer", ready: true, reason: null };
    }
    return {
      kind: "completeRound",
      ready: false,
      reason: `${facts.unreportedMatchCount} ${facts.unreportedMatchCount === 1 ? "match still needs" : "matches still need"} a result`,
      roundId: round._id,
    };
  }

  if (
    phase.phaseTotalRounds === null ||
    (facts.roundInPhase ?? 1) < phase.phaseTotalRounds
  ) {
    return {
      kind: "generateNextRound",
      ready: actions.generateNextRound.allowed,
      reason: actions.generateNextRound.reason,
    };
  }

  // The phase's configured rounds are done: the next round (if any) belongs to
  // the next phase, which generateNextRound starts.
  const nextPhase = facts.nextUpcomingPhase;
  if (nextPhase && nextPhase.phaseOrder === phase.phaseOrder + 1) {
    // An entry shortfall (a top-8 playoff without eight players, or a cutoff
    // fewer than two players cleared) leaves the next phase unpairable;
    // completing the tournament is the only move left.
    if (facts.nextPhaseEntryShortfall !== null) {
      return { kind: "completeTournament", ready: true, reason: null };
    }
    // A later phase can hold its own meeting (e.g. a day-2 seating) before its
    // first round is paired. Same player-count gate as the pre-start branch:
    // startPlayerMeeting rejects a pool of fewer than two players.
    if (playerMeetingPending(nextPhase)) {
      return startPlayerMeetingStep(
        nextPhase._id,
        facts.activeRegistrations?.length ?? 0,
      );
    }
    return {
      kind: "generateNextRound",
      ready: actions.generateNextRound.allowed,
      reason: actions.generateNextRound.reason,
    };
  }
  return { kind: "completeTournament", ready: true, reason: null };
}

function startPlayerMeetingStep(
  phaseId: Id<"tournamentPhases">,
  registrationCount: number,
): PairingsNextStep {
  if (registrationCount < 2) {
    return {
      kind: "startPlayerMeeting",
      ready: false,
      reason: "At least two active players are required",
      phaseId,
    };
  }
  return { kind: "startPlayerMeeting", ready: true, reason: null, phaseId };
}
