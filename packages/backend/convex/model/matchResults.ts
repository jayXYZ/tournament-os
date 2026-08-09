import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  auditResultLine,
  existingResultLines,
  logAuditEvent,
} from "./auditLog";
import { requireDecisiveEliminationResult } from "./phases";
import { matchPointsForResult } from "./standings";

// Who is writing the result. Everything the entry points do differently hangs
// off this one choice: the match-status precondition, who the result is
// attributed to, and how (or whether) the audit log records it.
export type MatchResultPolicy =
  | {
      // Organizer entry: may overwrite an existing result — this is also the
      // resolution path when players disagree — and supersedes any player
      // self-report. The audit event preserves the result it replaced.
      kind: "organizer";
      actor: Doc<"users">;
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
// points, patches both pairing rows plus the match, and appends the audit
// event the policy calls for. Callers resolve which rows the result belongs
// to; everything from validation onward lives here.
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
  requireDecisiveEliminationResult(
    phase,
    args.playerOneGameWins,
    args.playerTwoGameWins,
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
  await ctx.db.patch(match._id, {
    matchStatus: "completed",
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
      ),
      auditResultLine(
        playerTwo,
        args.playerTwoGameWins,
        args.playerOneGameWins,
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
