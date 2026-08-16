import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  phaseByOrder,
  phasesInOrder,
  roundNumberInPhase,
  selectCurrentPhase,
} from "./phases";
import { dropConcedesMatch } from "./matchResults";
import { participantPublicIdentity } from "./participants";
import { playerVisibleRegistration } from "./registrations";
import {
  isPairingsVisibleToPlayers,
  matchPlayers,
  playerMatchInRound,
  requireRound,
} from "./tournaments";

type OpponentSummary = {
  registrationId: Id<"tournamentRegistrations">;
  name: string | null;
  avatarUrl: string | null;
};

// The Player View (see CONTEXT.md): what this player faces in the tournament
// right now, always exactly one state. Masking is applied inside — callers
// pass the stored registration and never learn that a disqualified player
// reads as dropped.
export async function currentMatchForPlayer(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  storedRegistration: Doc<"tournamentRegistrations">,
) {
  // The rest of the view only distinguishes active from non-active, so
  // building the whole payload from the masked row changes nothing but the
  // reported status: a disqualified player reads as dropped, and the
  // clients' existing dropped branches render the removed-from-event state.
  const registration = playerVisibleRegistration(storedRegistration);
  // The Round Timer is deliberately absent: it is a tournament-level fact
  // visible to spectators too, so clients read it from getPublicTournament.
  const base = {
    tournament: {
      name: tournament.name,
      lifecycle: tournament.lifecycle,
    },
    myRegistrationStatus: registration.participationStatus,
    myRegistrationId: registration._id,
  };

  const phases = await phasesInOrder(ctx, tournament._id);
  const phase = selectCurrentPhase(phases);

  // A live player meeting takes over the play surface: until the phase's
  // first round is paired, the player's "match" is their alphabetical seat.
  // Covers a phase-1 meeting (lifecycle "setup"/"registration", matching
  // where startPlayerMeeting allows one) and a later-phase meeting held
  // between phases (lifecycle "in_progress").
  const meetingPhase =
    tournament.lifecycle !== "completed" && tournament.lifecycle !== "cancelled"
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
        ? await phaseByOrder(ctx, tournament._id, meetingPhase.phaseOrder - 1)
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
    ? await phaseByOrder(ctx, tournament._id, phase.phaseOrder + 1)
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
    const pending = await playerMatchInRound(ctx, registration._id, round._id);
    if (registration.participationStatus !== "active" && !pending) {
      return { kind: "no_match" as const, ...base, round: roundSummary };
    }
    return {
      kind: "pairings_pending" as const,
      ...base,
      round: roundSummary,
      // The engine concedes an unfinished current-round match on a drop even
      // while its pairings are unpublished — a state where this view shows
      // no match at all — so the fact must cross the seam explicitly for the
      // drop dialog to warn.
      dropWouldConcede: pending
        ? dropConcedesMatch(
            round,
            pending.match,
            (await matchPlayers(ctx, pending.match._id)).length,
          )
        : false,
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
    const opponentParticipant = opponentRegistration
      ? await ctx.db.get(opponentRegistration.participantId)
      : null;
    const identity = opponentParticipant
      ? await participantPublicIdentity(ctx, opponentParticipant)
      : { name: null, avatarUrl: null };
    opponent = {
      registrationId: opponentRow.playerId,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    };
  }

  // The player's side of the recorded result, read from the stored revision
  // line rather than re-derived from game counts (see matchResultLineValidator:
  // outcomes are stored so awarded results and double losses stay faithful).
  let outcome: "win" | "loss" | "draw" | null = null;
  if (match.currentResultRevisionId) {
    const revision = await ctx.db.get(match.currentResultRevisionId);
    outcome =
      revision?.lines.find((line) => line.registrationId === registration._id)
        ?.outcome ?? null;
  }

  return {
    kind: "match" as const,
    ...base,
    round: roundSummary,
    // Server truth for the drop dialog: same predicate the drop mutations
    // apply, so the warning cannot drift from what a drop will do.
    dropWouldConcede: dropConcedesMatch(round, match, players.length),
    match: {
      _id: match._id,
      tableNumber: match.tableNumber ?? null,
      matchStatus: match.matchStatus,
      reportedByRegistrationId: match.reportedByRegistrationId ?? null,
      // A concession from a mid-match drop completes the match with no
      // reporting player; without the kind, the client cannot tell it
      // apart from an organizer-entered result.
      currentResultKind: match.currentResultKind ?? null,
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
      outcome,
    },
    opponent,
  };
}
