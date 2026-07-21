import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  SINGLE_ELIMINATION_FORMAT,
  SINGLE_ELIMINATION_PLAYERS,
  SWISS_FORMAT,
  selectCurrentPhase,
} from "./phases";
import { activeRegistrations } from "./registrations";
import { isPairingsVisibleToPlayers, roundMatches } from "./tournaments";

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

export type PhaseBoard = {
  phase: Doc<"tournamentPhases">;
  rounds: Doc<"tournamentRounds">[];
};

// `phaseBoards` must hold every phase in phaseOrder with each phase's full
// round list in roundNumber order (the caller already loads exactly that);
// working off it keeps this from re-reading documents the query has in hand.
export async function pairingsNextStep(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  phaseBoards: PhaseBoard[],
  currentRoundMatches?: readonly Doc<"tournamentMatches">[],
): Promise<PairingsNextStep> {
  if (tournament.lifecycle === "cancelled") {
    return { kind: "tournamentCancelled" };
  }
  if (tournament.lifecycle === "completed") {
    return { kind: "tournamentCompleted" };
  }

  const phase = selectCurrentPhase(phaseBoards.map(({ phase }) => phase));
  const board =
    phaseBoards.find(({ phase: candidate }) => candidate._id === phase?._id) ??
    null;
  if (tournament.lifecycle === "setup") {
    const hasSwissPhase = phaseBoards.some(
      ({ phase: candidate }) => candidate.phaseType === SWISS_FORMAT,
    );
    return {
      kind: "publishTournament",
      ready: hasSwissPhase,
      reason: hasSwissPhase ? null : "Swiss phase is not configured",
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
    const registrations = await activeRegistrations(ctx, tournament._id);
    const hasTopEightPlayoff = phaseBoards.some(
      ({ phase: candidate }) =>
        candidate.phaseType === SINGLE_ELIMINATION_FORMAT &&
        candidate.phaseStatus === "upcoming",
    );
    if (
      hasTopEightPlayoff &&
      registrations.length < SINGLE_ELIMINATION_PLAYERS
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
    if (phase.playerMeeting && phase.playerMeetingStatus === undefined) {
      if (registrations.length < 2) {
        return {
          kind: "startPlayerMeeting",
          ready: false,
          reason: "At least two active players are required",
          phaseId: phase._id,
        };
      }
      return {
        kind: "startPlayerMeeting",
        ready: true,
        reason: null,
        phaseId: phase._id,
      };
    }
    if (registrations.length < 2) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "At least two active players are required",
      };
    }
    return { kind: "startTournament", ready: true, reason: null };
  }

  if (!board || !phase || !phase.phaseCurrentRound) {
    return {
      kind: "startTournament",
      ready: false,
      reason: "Current round not found",
    };
  }

  const round = board.rounds.find(
    (candidate) => candidate._id === phase.phaseCurrentRound,
  );
  if (!round) {
    throw new Error("Round not found");
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
    const matches = currentRoundMatches ?? (await roundMatches(ctx, round._id));
    const unreported = matches.reduce(
      (count, match) =>
        match.matchStatus === "completed" || match.matchStatus === "confirmed"
          ? count
          : count + 1,
      0,
    );
    // Once every match has a result, completing the round and posting standings
    // is the next step regardless of the timer (a round can finish without one
    // ever being started).
    if (unreported === 0) {
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
      reason: `${unreported} ${unreported === 1 ? "match still needs" : "matches still need"} a result`,
      roundId: round._id,
    };
  }

  // The round's 1-based position within its phase, as in roundNumberInPhase:
  // round numbers are global across the tournament, so offset from the
  // phase's first round.
  const roundInPhase = round.roundNumber - board.rounds[0].roundNumber + 1;
  const phaseTotalRounds = phase.phaseTotalRounds;
  if (phaseTotalRounds === null || roundInPhase < phaseTotalRounds) {
    return { kind: "generateNextRound", ready: true, reason: null };
  }

  // The phase's configured rounds are done: the next round (if any) belongs to
  // the next phase, which generateNextRound starts.
  const nextPhase =
    phaseBoards.find(
      (candidate) => candidate.phase.phaseOrder === phase.phaseOrder + 1,
    )?.phase ?? null;
  if (nextPhase && nextPhase.phaseStatus === "upcoming") {
    if (nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT) {
      const registrations = await activeRegistrations(ctx, tournament._id);
      if (registrations.length < SINGLE_ELIMINATION_PLAYERS) {
        return { kind: "completeTournament", ready: true, reason: null };
      }
    }
    // A later phase can hold its own meeting (e.g. a day-2 seating) before its
    // first round is paired. Same player-count gate as the pre-start branch:
    // startPlayerMeeting rejects a pool of fewer than two players.
    if (
      nextPhase.playerMeeting &&
      nextPhase.playerMeetingStatus === undefined
    ) {
      const registrations = await activeRegistrations(ctx, tournament._id);
      if (registrations.length < 2) {
        return {
          kind: "startPlayerMeeting",
          ready: false,
          reason: "At least two active players are required",
          phaseId: nextPhase._id,
        };
      }
      return {
        kind: "startPlayerMeeting",
        ready: true,
        reason: null,
        phaseId: nextPhase._id,
      };
    }
    return { kind: "generateNextRound", ready: true, reason: null };
  }
  return { kind: "completeTournament", ready: true, reason: null };
}
