import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { tournamentAuditEventValidator } from "../validators";

export type TournamentAuditEvent = Infer<typeof tournamentAuditEventValidator>;

export type AuditActorRole = "organizer" | "player";

// Appends one immutable row to the tournament's audit trail. Callers pass the
// acting user they already resolved for authorization, so logging never adds
// an extra read.
export async function logAuditEvent(
  ctx: MutationCtx,
  args: {
    tournamentId: Id<"tournaments">;
    actor: Doc<"users">;
    actorRole: AuditActorRole;
    event: TournamentAuditEvent;
  },
) {
  await ctx.db.insert("tournamentAuditEvents", {
    tournamentId: args.tournamentId,
    actorUserId: args.actor._id,
    // Same fallback as playerDisplayName, inlined to keep this module free of
    // a model/tournaments import cycle.
    actorName: args.actor.name ?? args.actor.email ?? null,
    actorRole: args.actorRole,
    event: args.event,
  });
}

// Shapes a registration into the audit log's denormalized player reference.
export function auditPlayerRef(registration: Doc<"tournamentRegistrations">) {
  return {
    registrationId: registration._id,
    playerName: registration.playerName ?? null,
  };
}

// One side of a match result as captured in the log. Match-player rows carry
// a denormalized playerName from pairing time.
export function auditResultLine(
  playerRow: Doc<"tournamentMatchPlayers">,
  gameWins: number,
  gameLosses: number,
) {
  return {
    registrationId: playerRow.playerId,
    playerName: playerRow.playerName ?? null,
    gameWins,
    gameLosses,
  };
}

// The result already on a match's player rows, for logging what an organizer
// override replaced. Null when the match had no result yet.
export function existingResultLines(
  match: Doc<"tournamentMatches">,
  playerRows: Doc<"tournamentMatchPlayers">[],
) {
  if (match.matchStatus !== "completed" && match.matchStatus !== "confirmed") {
    return null;
  }
  return playerRows.map((row) =>
    auditResultLine(row, row.gameWins ?? 0, row.gameLosses ?? 0),
  );
}
