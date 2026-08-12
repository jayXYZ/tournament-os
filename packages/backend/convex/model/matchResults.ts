import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "./auditLog";
import { requireValidMatchResult } from "./phases";
import { matchPointsForResult } from "./standings";

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
      // stamps the reporter so the opponent (not the reporter) can confirm.
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

  if (policy.kind === "player" && match.matchStatus !== "upcoming") {
    throw new Error("Match already has a result");
  }
  if (
    policy.kind === "simulation" &&
    (match.matchStatus === "completed" || match.matchStatus === "confirmed")
  ) {
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

  // The immutable adjudication record; the row patches below are the
  // denormalized copy standings and pairings read.
  const outcomeOf = (points: number) =>
    points === 3
      ? ("win" as const)
      : points === 1
        ? ("draw" as const)
        : ("loss" as const);
  const revisionId = await ctx.db.insert("matchResultRevisions", {
    tournamentId: match.tournamentId,
    tournamentMatchId: match._id,
    kind: "played",
    lines: [
      {
        registrationId: playerOne.playerId,
        outcome: outcomeOf(playerOnePoints),
        matchPointsEarned: playerOnePoints,
        gameWins: args.playerOneGameWins,
        gameLosses: args.playerTwoGameWins,
        gameDraws: args.gameDraws,
      },
      {
        registrationId: playerTwo.playerId,
        outcome: outcomeOf(playerTwoPoints),
        matchPointsEarned: playerTwoPoints,
        gameWins: args.playerTwoGameWins,
        gameLosses: args.playerOneGameWins,
        gameDraws: args.gameDraws,
      },
    ],
    ...(policy.kind === "simulation"
      ? {}
      : { actorUserId: policy.actor._id, actorRole: policy.kind }),
    ...(policy.kind === "organizer" && policy.note !== undefined
      ? { note: policy.note }
      : {}),
  });

  await ctx.db.patch(playerOne._id, {
    matchPointsEarned: playerOnePoints,
    gameWins: args.playerOneGameWins,
    gameLosses: args.playerTwoGameWins,
    gameDraws: args.gameDraws,
    updatedAt: now,
  });
  await ctx.db.patch(playerTwo._id, {
    matchPointsEarned: playerTwoPoints,
    gameWins: args.playerTwoGameWins,
    gameLosses: args.playerOneGameWins,
    gameDraws: args.gameDraws,
    updatedAt: now,
  });
  await ctx.db.patch(match._id, {
    matchStatus: "completed",
    currentResultRevisionId: revisionId,
    // Only a player self-report carries a reporter; an organizer result
    // clears it, superseding any report awaiting confirmation.
    reportedByRegistrationId:
      policy.kind === "player" ? policy.reporterRegistrationId : undefined,
    updatedAt: now,
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
    actorRole: policy.kind,
    event:
      policy.kind === "organizer"
        ? { type: "match_result_recorded", ...eventBase, previousResult }
        : { type: "match_result_reported", ...eventBase },
  });
  return "applied";
}
