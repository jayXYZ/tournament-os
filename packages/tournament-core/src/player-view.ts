import { formatGameScoreline } from "./format";
import type { MyActiveMatch, MyCurrentMatch } from "./types";

// Presenter for the Player View (see CONTEXT.md): every app renders these
// descriptions verbatim, so state branching and copy exist once and cannot
// drift between clients. Apps own styling and mutation wiring only.

export type CurrentMatchAction = {
  kind: "report";
  matchId: MyActiveMatch["match"]["_id"];
  bestOf: MyActiveMatch["match"]["bestOf"];
  opponentName: string;
};

export type BadgeTone = "default" | "secondary" | "outline" | "destructive";

export type PlayerBadge = { label: string; tone: BadgeTone };

export type CurrentMatchDescription =
  | { kind: "loading" }
  // A stateless wait or empty state: icon + title + body, no card chrome.
  | {
      kind: "status";
      icon: "hourglass" | "swords";
      title: string;
      body: string;
    }
  // A seat or match card: label eyebrow, title, optional companion line,
  // then whichever of body / scoreline+badge / note / action the state has.
  | {
      kind: "card";
      label: string;
      title: string;
      subtitle: string | null;
      body: string | null;
      scoreline: string | null;
      badge: PlayerBadge | null;
      note: string | null;
      action: CurrentMatchAction | null;
    };

export function describeCurrentMatch(
  currentMatch: MyCurrentMatch | undefined,
): CurrentMatchDescription {
  if (currentMatch === undefined) {
    return { kind: "loading" };
  }

  if (currentMatch.kind === "not_started") {
    return {
      kind: "status",
      icon: "hourglass",
      title: "Waiting for round one",
      body: "Pairings will appear here as soon as the organizer starts the tournament.",
    };
  }

  if (currentMatch.kind === "player_meeting") {
    if (currentMatch.myRegistrationStatus === "dropped") {
      return {
        kind: "status",
        icon: "swords",
        title: "No seat for the player meeting",
        body: "You have dropped from this tournament, so you are no longer seated.",
      };
    }
    return {
      kind: "card",
      label: "Player meeting",
      title:
        currentMatch.meeting.tableNumber === null
          ? "See the organizer for your seat"
          : `Table ${currentMatch.meeting.tableNumber}`,
      subtitle: currentMatch.meeting.seatmateName
        ? `with ${currentMatch.meeting.seatmateName}`
        : null,
      body: "Take your seat and check in with the organizer. Pairings will appear here once the meeting wraps up.",
      scoreline: null,
      badge: null,
      note: null,
      action: null,
    };
  }

  if (currentMatch.kind === "between_rounds") {
    return {
      kind: "status",
      icon: "hourglass",
      title: `Round ${currentMatch.round.roundNumber} complete`,
      body: currentMatch.round.isFinalRound
        ? "That was the final round. Check the standings tab for the final results."
        : "Hang tight — the organizer is preparing the next round's pairings.",
    };
  }

  if (currentMatch.kind === "pairings_pending") {
    return {
      kind: "status",
      icon: "hourglass",
      title: `Round ${currentMatch.round.roundNumber} pairings pending`,
      body: "The organizer is reviewing this round's pairings. They will appear here once published.",
    };
  }

  if (currentMatch.kind === "no_match") {
    return {
      kind: "status",
      icon: "swords",
      title: "No match this round",
      body:
        currentMatch.myRegistrationStatus === "dropped"
          ? "You have dropped from this tournament, so you are no longer paired."
          : "You are not paired this round.",
    };
  }

  return describeActiveMatch(currentMatch);
}

// Whether the viewer can report their current match, with everything the
// report dialog needs. The availability rule lives here so the card's report
// button and the drop dialog's concession warning read the same answer.
export function reportAction(
  currentMatch: MyCurrentMatch | undefined,
): CurrentMatchAction | null {
  if (currentMatch === undefined || currentMatch.kind !== "match") {
    return null;
  }
  const { match, me, opponent } = currentMatch;
  if (me.isBye || match.matchStatus !== "upcoming") {
    return null;
  }
  return {
    kind: "report",
    matchId: match._id,
    bestOf: match.bestOf,
    opponentName: opponent?.name ?? "Opponent",
  };
}

// The drop confirmation dialog's description. The concession half reads the
// server's dropWouldConcede fact rather than deriving from the visible
// match: the engine concedes an unfinished current-round match even while
// its pairings are still unpublished — a state with no match card to derive
// from — so only the server can answer.
export function describeDropConfirmation(
  currentMatch: MyCurrentMatch | undefined,
): string {
  const wouldConcede =
    currentMatch !== undefined &&
    (currentMatch.kind === "match" ||
      currentMatch.kind === "pairings_pending") &&
    currentMatch.dropWouldConcede;
  if (!wouldConcede) {
    return "You will not be paired in any future rounds. Dropping cannot be undone from here; the organizer can reinstate you.";
  }
  // Before pairings are published the match cannot have been played, so the
  // "report the real result first" nudge would ask the impossible.
  if (currentMatch.kind === "pairings_pending") {
    return "This round already includes a match for you — dropping now concedes it, and your opponent takes the win. Dropping cannot be undone from here; the organizer can reinstate you.";
  }
  return "Your current match has no result yet — dropping now concedes it, and your opponent takes the win. If you actually finished the match, report the real result first. Dropping cannot be undone from here; the organizer can reinstate you.";
}

// The compact status badge for a header or app bar. A drop outranks
// everything; a completed tournament outranks round state.
export function describeHeaderBadge(
  currentMatch: MyCurrentMatch | undefined,
): PlayerBadge | null {
  if (currentMatch === undefined) {
    return null;
  }
  if (currentMatch.myRegistrationStatus === "dropped") {
    return { label: "Dropped", tone: "destructive" };
  }
  if (currentMatch.tournament.lifecycle === "completed") {
    return { label: "Completed", tone: "secondary" };
  }
  if (currentMatch.kind === "not_started") {
    return { label: "Not started", tone: "outline" };
  }
  if (
    currentMatch.kind === "match" ||
    currentMatch.kind === "between_rounds" ||
    currentMatch.kind === "pairings_pending"
  ) {
    return {
      label: `Round ${currentMatch.round.roundNumber}`,
      tone: "default",
    };
  }
  return null;
}

function describeActiveMatch(
  currentMatch: MyActiveMatch,
): CurrentMatchDescription {
  const { match, me, opponent, round } = currentMatch;
  const label = round.isFinalRound
    ? `${round.roundName} · Final round`
    : round.roundName;

  // A bye is completed at pairing time, so it must precede the result
  // branches: the player sees the award, never a scoreline.
  if (me.isBye) {
    return {
      kind: "card",
      label,
      title: "You have a bye",
      subtitle: null,
      body: "You receive an automatic match win this round. Sit back and enjoy the break.",
      scoreline: null,
      badge: null,
      note: null,
      action: null,
    };
  }

  const title = `Table ${match.tableNumber ?? "—"}`;
  const subtitle = `vs ${opponent?.name ?? "your opponent"}`;

  if (match.matchStatus === "upcoming") {
    return {
      kind: "card",
      label,
      title,
      subtitle,
      body: "Play your match, then report the result here. Either player can report.",
      scoreline: null,
      badge: null,
      note: null,
      action: reportAction(currentMatch),
    };
  }

  return {
    kind: "card",
    label,
    title,
    subtitle,
    body: null,
    scoreline: scorelineForResult(me),
    ...resultProvenance(currentMatch),
    action: null,
  };
}

// A drop's concession (see CONTEXT.md "Concession") completes the match with
// no reporting player, so it must be distinguished before the reporter
// branches; a completed match with no reporter was entered by the organizer.
function resultProvenance(currentMatch: MyActiveMatch): {
  badge: PlayerBadge;
  note: string | null;
} {
  const { match, me } = currentMatch;
  if (match.currentResultKind === "concession") {
    return {
      badge: {
        label: me.outcome === "loss" ? "You conceded" : "Opponent conceded",
        tone: "secondary",
      },
      note: "A drop during an unfinished match concedes it. Played to a result first? Find a judge or the tournament organizer.",
    };
  }
  if (match.reportedByRegistrationId) {
    return {
      badge: {
        label:
          match.reportedByRegistrationId === me.registrationId
            ? "Reported by you"
            : "Reported by opponent",
        tone: "outline",
      },
      note: "Result wrong? Find a judge or the tournament organizer.",
    };
  }
  return {
    badge: { label: "Recorded by organizer", tone: "secondary" },
    note: null,
  };
}

function scorelineForResult(me: MyActiveMatch["me"]): string {
  const wins = me.gameWins ?? 0;
  const losses = me.gameLosses ?? 0;
  const scoreline = formatGameScoreline(wins, losses, me.gameDraws ?? 0);
  // The stored result line is authoritative — awarded results and double
  // losses are not derivable from game counts. The comparison is only a
  // fallback for a completed match missing its revision.
  const outcome =
    me.outcome ?? (wins > losses ? "win" : wins < losses ? "loss" : "draw");
  if (outcome === "win") {
    return `You win ${scoreline}`;
  }
  if (outcome === "loss") {
    return `You lose ${scoreline}`;
  }
  return `Draw ${scoreline}`;
}
