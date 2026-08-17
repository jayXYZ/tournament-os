import { requiredGameWins } from "@tournament-os/shared/match-structure";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AuditActorRole } from "./auditLog";
import {
  auditPlayerRef,
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "./auditLog";
import { currentPhaseOrNull, requireValidMatchResult } from "./phases";
import { BYE_MATCH_POINTS, matchPointsForResult } from "./standings";
import {
  matchPlayers,
  playerMatchInRound,
  roundMatchesWithPlayers,
} from "./tournaments";

// Revisions live and die with their match: deleting a match (a rewind
// un-pairing its round, or tournament deletion) deletes its revisions too.
// Returns how many documents were deleted for callers with write budgets.
export async function deleteResultRevisionsForMatch(
  ctx: MutationCtx,
  matchId: Id<"tournamentMatches">,
) {
  const revisions = await ctx.db
    .query("matchResultRevisions")
    .withIndex("by_tournamentMatchId", (q) =>
      q.eq("tournamentMatchId", matchId),
    )
    .take(64);
  for (const revision of revisions) {
    await ctx.db.delete(revision._id);
  }
  return revisions.length;
}

// Who is writing the result. Everything the entry points do differently hangs
// off this one choice: the match-status precondition, who the result is
// attributed to, and how (or whether) the audit log records it.
export type MatchResultPolicy =
  | {
      // Organizer entry: may overwrite an existing result — this is also the
      // resolution path when players disagree — and supersedes any player
      // self-report. The audit event preserves the result it replaced, and
      // the optional note records why the organizer changed it.
      kind: "organizer";
      actor: Doc<"users">;
      note?: string;
    }
  | {
      // Player self-report: only valid while the match has no result, and
      // stamps the reporter for provenance and dispute resolution.
      kind: "player";
      actor: Doc<"users">;
      reporterRegistrationId: Id<"tournamentRegistrations">;
    }
  | {
      // Seeded test simulation: silently skips matches that already have a
      // result. audit: "none" is a decision, not an oversight — simulated
      // results are not actions anyone took, so they stay out of the
      // tournament's audit trail.
      kind: "simulation";
      audit: "none";
    }
  | {
      // A drop conceding the player's own unfinished match (see CONTEXT.md
      // "Concession"): an Awarded Result, valid only while the match has no
      // result. The actor is whoever recorded the drop, so the role varies —
      // the player themself or an organizer.
      kind: "concession";
      actor: Doc<"users">;
      actorRole: AuditActorRole;
      concededBy: Doc<"tournamentRegistrations">;
    };

// The one writer for match results. Validates the result, computes match
// points and per-player outcomes, appends the immutable result revision,
// patches both pairing rows plus the match, and appends the audit event the
// policy calls for. Callers resolve which rows the result belongs to;
// everything from validation onward lives here.
export async function applyMatchResult(
  ctx: MutationCtx,
  args: {
    match: Doc<"tournamentMatches">;
    phase: Doc<"tournamentPhases">;
    round: Doc<"tournamentRounds">;
    // The match's pairing rows; playerOneGameWins belongs to players[0].
    players: Doc<"tournamentMatchPlayers">[];
    playerOneGameWins: number;
    playerTwoGameWins: number;
    // Drawn games are shared, so one count covers both players.
    gameDraws: number;
    policy: MatchResultPolicy;
  },
): Promise<"applied" | "skipped"> {
  const { match, phase, players, policy } = args;

  if (
    (policy.kind === "player" || policy.kind === "concession") &&
    match.matchStatus !== "upcoming"
  ) {
    throw new Error("Match already has a result");
  }
  if (policy.kind === "simulation" && match.matchStatus === "completed") {
    return "skipped";
  }
  if (players.length !== 2 || players[0]._id === players[1]._id) {
    throw new Error("Match result requires exactly two players");
  }
  requireValidMatchResult(
    phase,
    args.playerOneGameWins,
    args.playerTwoGameWins,
    args.gameDraws,
  );

  const [playerOne, playerTwo] = players;
  const [playerOnePoints, playerTwoPoints] = matchPointsForResult({
    playerOneGameWins: args.playerOneGameWins,
    playerTwoGameWins: args.playerTwoGameWins,
  });
  // Captured before the patches below overwrite the rows: a non-null value
  // means an organizer edited an existing result, which the log must preserve.
  const previousResult =
    policy.kind === "organizer" ? existingResultLines(match, players) : null;
  const now = Date.now();

  const outcomeOf = (points: number) =>
    points === 3
      ? ("win" as const)
      : points === 1
        ? ("draw" as const)
        : ("loss" as const);
  const kind =
    policy.kind === "concession"
      ? ("concession" as const)
      : ("played" as const);
  await recordCurrentResult(ctx, {
    match,
    kind,
    seats: [
      {
        rowId: playerOne._id,
        line: {
          registrationId: playerOne.playerId,
          outcome: outcomeOf(playerOnePoints),
          matchPointsEarned: playerOnePoints,
          gameWins: args.playerOneGameWins,
          gameLosses: args.playerTwoGameWins,
          gameDraws: args.gameDraws,
        },
      },
      {
        rowId: playerTwo._id,
        line: {
          registrationId: playerTwo.playerId,
          outcome: outcomeOf(playerTwoPoints),
          matchPointsEarned: playerTwoPoints,
          gameWins: args.playerTwoGameWins,
          gameLosses: args.playerOneGameWins,
          gameDraws: args.gameDraws,
        },
      },
    ],
    ...(policy.kind === "simulation"
      ? {}
      : {
          actor: {
            actorUserId: policy.actor._id,
            actorRole:
              policy.kind === "concession" ? policy.actorRole : policy.kind,
          },
        }),
    ...(policy.kind === "organizer" && policy.note !== undefined
      ? { note: policy.note }
      : {}),
    // Only a player self-report carries a reporter; an organizer result
    // clears it, superseding any report awaiting confirmation.
    reportedByRegistrationId:
      policy.kind === "player" ? policy.reporterRegistrationId : undefined,
    now,
  });

  if (policy.kind === "simulation") {
    return "applied";
  }
  const eventBase = {
    matchId: match._id,
    roundNumber: args.round.roundNumber,
    tableNumber: match.tableNumber ?? null,
    result: [
      auditResultLine(
        playerOne,
        args.playerOneGameWins,
        args.playerTwoGameWins,
        args.gameDraws,
      ),
      auditResultLine(
        playerTwo,
        args.playerTwoGameWins,
        args.playerOneGameWins,
        args.gameDraws,
      ),
    ],
  };
  await logAuditEvent(ctx, {
    tournamentId: match.tournamentId,
    actor: policy.actor,
    actorRole: policy.kind === "concession" ? policy.actorRole : policy.kind,
    event:
      policy.kind === "concession"
        ? {
            type: "match_conceded",
            ...eventBase,
            player: auditPlayerRef(policy.concededBy),
          }
        : policy.kind === "organizer"
          ? { type: "match_result_recorded", ...eventBase, previousResult }
          : { type: "match_result_reported", ...eventBase },
  });
  return "applied";
}

// One line of a result revision: a player's stored side of the outcome.
type ResultLine = Doc<"matchResultRevisions">["lines"][number];

// The one writer of a match's current result: the immutable revision plus
// every denormalized copy — the per-seat stats on the player rows (the hot
// read model for standings and pairings) and the match's completion with its
// currentResultRevisionId/currentResultKind pointer pair, which the schema
// requires written together. Both result writers (applyMatchResult and the
// pairing-time materializeAwardedByeMatch) funnel through here, so the
// pointer-pair invariant is structural rather than a convention upheld in
// two files.
async function recordCurrentResult(
  ctx: MutationCtx,
  args: {
    match: Pick<Doc<"tournamentMatches">, "_id" | "tournamentId">;
    kind: Doc<"matchResultRevisions">["kind"];
    // One entry per seat, pairing each player row with its revision line;
    // the revision stores the lines in this order.
    seats: Array<{ rowId: Id<"tournamentMatchPlayers">; line: ResultLine }>;
    // Absent for system-written revisions: byes at pairing time and seeded
    // test simulation.
    actor?: { actorUserId: Id<"users">; actorRole: AuditActorRole };
    note?: string;
    reportedByRegistrationId?: Id<"tournamentRegistrations">;
    now: number;
  },
) {
  const revisionId = await ctx.db.insert("matchResultRevisions", {
    tournamentId: args.match.tournamentId,
    tournamentMatchId: args.match._id,
    kind: args.kind,
    lines: args.seats.map((seat) => seat.line),
    ...(args.actor ?? {}),
    ...(args.note !== undefined ? { note: args.note } : {}),
  });
  for (const { rowId, line } of args.seats) {
    await ctx.db.patch(rowId, {
      matchPointsEarned: line.matchPointsEarned,
      gameWins: line.gameWins,
      gameLosses: line.gameLosses,
      gameDraws: line.gameDraws,
      updatedAt: args.now,
    });
  }
  await ctx.db.patch(args.match._id, {
    matchStatus: "completed",
    currentResultRevisionId: revisionId,
    currentResultKind: args.kind,
    reportedByRegistrationId: args.reportedByRegistrationId,
    updatedAt: args.now,
  });
  return revisionId;
}

// A Bye is an Awarded Result: the phase's required game wins to zero (2–0 in
// best-of-3), materialized whole at pairing time — the match, its single
// seat, and a system-awarded "bye" revision with no actor and deliberately
// no audit event (nobody took an action). One writer for both the Swiss bye
// and the bracket walkover, which ADR 0001 records as a Bye.
export async function materializeAwardedByeMatch(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundId: Id<"tournamentRounds">;
    registration: Doc<"tournamentRegistrations">;
    // The bye's seat-pair position in a bracket round; absent for Swiss byes.
    bracketSeat?: number;
    now: number;
  },
) {
  const matchId = await ctx.db.insert("tournamentMatches", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    tournamentRoundId: args.roundId,
    tableNumber: undefined,
    bracketSeat: args.bracketSeat,
    matchStatus: "upcoming",
    updatedAt: args.now,
  });
  const rowId = await ctx.db.insert("tournamentMatchPlayers", {
    tournamentMatchId: matchId,
    playerId: args.registration._id,
    playerName: args.registration.playerName,
    isBye: true,
    updatedAt: args.now,
  });
  // Inserted bare and completed by the shared tail, so the bye's result
  // facts have the same single writer as every reported result.
  await recordCurrentResult(ctx, {
    match: { _id: matchId, tournamentId: args.tournament._id },
    kind: "bye",
    seats: [
      {
        rowId,
        line: {
          registrationId: args.registration._id,
          outcome: "win",
          matchPointsEarned: BYE_MATCH_POINTS,
          gameWins: requiredGameWins(args.phase.bestOf),
          gameLosses: 0,
          gameDraws: 0,
        },
      },
    ],
    now: args.now,
  });
  return matchId;
}

// A player's side of a match's recorded result, read from the stored
// revision line — outcomes are stored rather than re-derived from game
// counts (see matchResultLineValidator) so awarded results and double
// losses stay faithful. Null while the match carries no result. Every
// surface that labels a result for a player (the Player View's match card,
// the match log) reads through here, so no two of them can disagree about
// what a revision says.
export async function storedOutcomeForPlayer(
  ctx: QueryCtx,
  match: Doc<"tournamentMatches">,
  registrationId: Id<"tournamentRegistrations">,
): Promise<ResultLine["outcome"] | null> {
  if (!match.currentResultRevisionId) {
    return null;
  }
  const revision = await ctx.db.get(match.currentResultRevisionId);
  return (
    revision?.lines.find((line) => line.registrationId === registrationId)
      ?.outcome ?? null
  );
}

// A drop's match consequence (see CONTEXT.md "Drop" and "Concession"): a
// Whether a drop by one of the match's players concedes it. The one
// statement of the Concession precondition: the drop mutations apply it and
// the Player View and organizer roster warn from it, so the warnings can
// never drift from what a drop will do. "upcoming" is the only concedeable
// state: byes complete at pairing time (the two-player check is their
// backstop), and a match with a result stands — including the concession an
// opponent's earlier drop already awarded. Pairings visibility is
// deliberately absent: a drop concedes the open round's match even before
// its pairings are published.
export function dropConcedesMatch(
  round: Pick<Doc<"tournamentRounds">, "roundStatus">,
  match: Pick<Doc<"tournamentMatches">, "matchStatus">,
  playerCount: number,
) {
  return (
    round.roundStatus === "in_progress" &&
    match.matchStatus === "upcoming" &&
    playerCount === 2
  );
}

// player dropping during their own unfinished match concedes it, so the
// opponent immediately wins an Awarded Result — the structure's required
// game wins to zero, with no per-tournament configuration. A match that
// already has a result is left alone: a finished match is reported before
// the drop, or fixed by organizer override afterwards. Both drop entry
// points (player self-drop, organizer drop) call this with the drop's actor.
export async function concedeUnfinishedMatchOnDrop(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
    actor: Doc<"users">;
    actorRole: AuditActorRole;
  },
) {
  const phase = await currentPhaseOrNull(ctx, args.tournament._id);
  if (!phase?.phaseCurrentRound) {
    return;
  }
  const round = await ctx.db.get(phase.phaseCurrentRound);
  if (!round) {
    return;
  }
  const found = await playerMatchInRound(ctx, args.registration._id, round._id);
  if (!found) {
    return;
  }
  const players = await matchPlayers(ctx, found.match._id);
  if (!dropConcedesMatch(round, found.match, players.length)) {
    return;
  }
  const required = requiredGameWins(phase.bestOf);
  const concedesFirst = players[0].playerId === args.registration._id;
  await applyMatchResult(ctx, {
    match: found.match,
    phase,
    round,
    players,
    playerOneGameWins: concedesFirst ? 0 : required,
    playerTwoGameWins: concedesFirst ? required : 0,
    gameDraws: 0,
    policy: {
      kind: "concession",
      actor: args.actor,
      actorRole: args.actorRole,
      concededBy: args.registration,
    },
  });
}

// The registrations whose drop would concede a match right now: every seat
// in a concedeable match of the open round. Computed once per roster read so
// each row's drop action can carry the fact instead of the client hedging.
export async function registrationsConcededByDrop(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
): Promise<Set<Id<"tournamentRegistrations">>> {
  const concedeable = new Set<Id<"tournamentRegistrations">>();
  if (tournament.lifecycle !== "in_progress") {
    return concedeable;
  }
  const phase = await currentPhaseOrNull(ctx, tournament._id);
  if (!phase?.phaseCurrentRound) {
    return concedeable;
  }
  const round = await ctx.db.get(phase.phaseCurrentRound);
  if (!round || round.roundStatus !== "in_progress") {
    return concedeable;
  }
  for (const { match, players } of await roundMatchesWithPlayers(
    ctx,
    round._id,
  )) {
    if (dropConcedesMatch(round, match, players.length)) {
      for (const player of players) {
        concedeable.add(player.playerId);
      }
    }
  }
  return concedeable;
}
