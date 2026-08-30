import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { parseMoneyRowEntry, parseMoneyRowOwner } from "./paidEventOwner";
import type {
  conventionAuditEventValidator,
  tournamentAuditEventValidator,
} from "../validators";

export type TournamentAuditEvent = Infer<typeof tournamentAuditEventValidator>;
export type ConventionAuditEvent = Infer<typeof conventionAuditEventValidator>;

export type AuditActorRole = "organizer" | "player" | "system";

// The actor half of an audit append, shared by both logs.
type AuditActorArgs =
  | { actor: Doc<"users">; actorRole: Exclude<AuditActorRole, "system"> }
  | { actorRole: "system" };

// Appends one immutable row to the tournament's audit trail. Callers pass the
// acting user they already resolved for authorization, so logging never adds
// an extra read. System events (payment webhooks, scheduled sweeps) have no
// acting user: they pass the "system" role in place of an actor.
export async function logAuditEvent(
  ctx: MutationCtx,
  args: {
    tournamentId: Id<"tournaments">;
    event: TournamentAuditEvent;
  } & AuditActorArgs,
) {
  const actor = "actor" in args ? args.actor : null;
  await ctx.db.insert("tournamentAuditEvents", {
    tournamentId: args.tournamentId,
    actorUserId: actor?._id,
    // Same fallback as playerDisplayName, inlined to keep this module free of
    // a model/tournaments import cycle.
    actorName: actor ? (actor.name ?? actor.email ?? null) : null,
    actorRole: args.actorRole,
    event: args.event,
  });
}

// The convention log's append, mirroring logAuditEvent.
export async function logConventionAuditEvent(
  ctx: MutationCtx,
  args: {
    conventionId: Id<"conventions">;
    event: ConventionAuditEvent;
  } & AuditActorArgs,
) {
  const actor = "actor" in args ? args.actor : null;
  await ctx.db.insert("conventionAuditEvents", {
    conventionId: args.conventionId,
    actorUserId: actor?._id,
    actorName: actor ? (actor.name ?? actor.email ?? null) : null,
    actorRole: args.actorRole,
    event: args.event,
  });
}

// Shapes a badge registration into the convention log's player reference.
export function conventionAuditPlayerRef(
  registration: Doc<"conventionRegistrations">,
) {
  return {
    registrationId: registration._id,
    playerName: registration.playerName ?? null,
  };
}

// The payment/refund audit arms shared verbatim by both logs, minus the
// player ref this router fills in.
export type PaidEntryAuditEvent =
  | { type: "payment_completed"; totalCents: number }
  | { type: "payment_failed" }
  | { type: "payment_expired" }
  | {
      type: "refund_issued";
      kind: Doc<"paymentRefunds">["kind"];
      reason: Doc<"paymentRefunds">["reason"];
      amountCents: number;
    }
  | { type: "refund_failed"; amountCents: number }
  | { type: "order_disputed" };

// Routes a payment-shaped audit event to the log of the paid event that owns
// the money row. The owner pair comes straight off a paymentOrders or
// paymentRefunds row; parseMoneyRowEntry (model/paidEventOwner.ts) turns it
// into the discriminated owner-plus-registration reference.
export async function logEntryPaymentAudit(
  ctx: MutationCtx,
  args: {
    owner: {
      tournamentId?: Id<"tournaments">;
      conventionId?: Id<"conventions">;
    };
    registration: {
      _id: Id<"tournamentRegistrations"> | Id<"conventionRegistrations">;
      playerName?: string;
    };
    event: PaidEntryAuditEvent;
  } & AuditActorArgs,
) {
  const actorArgs: AuditActorArgs =
    "actor" in args
      ? { actor: args.actor, actorRole: args.actorRole }
      : { actorRole: "system" };
  const entry = parseMoneyRowEntry({
    ...args.owner,
    registrationId: args.registration._id,
  });
  // One construction for both logs; generic over the per-table
  // registrationId each log's player ref demands.
  const eventWithPlayer = <RegistrationId>(registrationId: RegistrationId) => ({
    ...args.event,
    player: {
      registrationId,
      playerName: args.registration.playerName ?? null,
    },
  });
  if (entry.kind === "convention") {
    await logConventionAuditEvent(ctx, {
      conventionId: entry.conventionId,
      event: eventWithPlayer(entry.registrationId),
      ...actorArgs,
    });
    return;
  }
  await logAuditEvent(ctx, {
    tournamentId: entry.tournamentId,
    event: eventWithPlayer(entry.registrationId),
    ...actorArgs,
  });
}

// Routes a payout audit event (no player) to the owning event's log.
export async function logEventPayoutAudit(
  ctx: MutationCtx,
  args: {
    owner: {
      tournamentId?: Id<"tournaments">;
      conventionId?: Id<"conventions">;
    };
    event:
      | { type: "payout_sent"; netCents: number }
      | { type: "payout_failed" };
  },
) {
  const owner = parseMoneyRowOwner(args.owner);
  if (owner.kind === "convention") {
    await logConventionAuditEvent(ctx, {
      conventionId: owner.conventionId,
      event: args.event,
      actorRole: "system",
    });
    return;
  }
  await logAuditEvent(ctx, {
    tournamentId: owner.tournamentId,
    event: args.event,
    actorRole: "system",
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
  gameDraws: number,
) {
  return {
    registrationId: playerRow.playerId,
    playerName: playerRow.playerName ?? null,
    gameWins,
    gameLosses,
    gameDraws,
  };
}

// The result already on a match's player rows, for logging what an organizer
// override replaced. Null when the match had no result yet.
export function existingResultLines(
  match: Doc<"tournamentMatches">,
  playerRows: Doc<"tournamentMatchPlayers">[],
) {
  if (match.matchStatus !== "completed") {
    return null;
  }
  return playerRows.map((row) =>
    auditResultLine(
      row,
      row.gameWins ?? 0,
      row.gameLosses ?? 0,
      row.gameDraws ?? 0,
    ),
  );
}
