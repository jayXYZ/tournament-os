import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { parseMoneyRowEntry, parseMoneyRowOwner } from "./paidEventOwner";
import { participantOrganizerName } from "./participants";
import type {
  conventionAuditEventValidator,
  tournamentAuditEventValidator,
} from "../validators";

export type TournamentAuditEvent = Infer<typeof tournamentAuditEventValidator>;
export type ConventionAuditEvent = Infer<typeof conventionAuditEventValidator>;

export type AuditActorRole = "organizer" | "player" | "system";

// The organizer label for an account the caller already holds: the same
// name-then-email rule as participantOrganizerName, with no read. Used for
// the actor of every append and for the player reference when the registrant
// is acting on their own entry (registering, cancelling, submitting a
// decklist), where the acting user is the player.
export function auditUserLabel(user: Doc<"users">): string | null {
  return user.name ?? user.email ?? null;
}

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
    // Organizer-only log, so the actor label may fall back to the email
    // (unlike playerDisplayName, whose stamp reaches other players).
    actorName: actor ? auditUserLabel(actor) : null,
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
    actorName: actor ? auditUserLabel(actor) : null,
    actorRole: args.actorRole,
    event: args.event,
  });
}

// The label an audit row stores for a registration or badge: the stamped
// playerName when the account has one, otherwise the participant's organizer
// label, which falls back to the email. The stamp is name-only because its
// copies reach other players (playerDisplayName); both audit logs are
// organizer-only by access, so they are the one place that label is
// denormalized. Resolving it here, once per append, keeps the two list
// queries free of per-row joins and off every user document's subscription.
// A named account reads nothing; a nameless one costs two reads (participant,
// user) per event — and none when the caller holds the registrant's user
// document (auditUserLabel). Null only when the participant is gone.
async function auditPlayerLabel(
  ctx: MutationCtx,
  registration: { playerName?: string; participantId: Id<"participants"> },
): Promise<string | null> {
  if (registration.playerName !== undefined) {
    return registration.playerName;
  }
  const participant = await ctx.db.get(registration.participantId);
  return participant ? await participantOrganizerName(ctx, participant) : null;
}

// Shapes a registration into the audit log's denormalized player reference.
export async function auditPlayerRef(
  ctx: MutationCtx,
  registration: Doc<"tournamentRegistrations">,
) {
  return {
    registrationId: registration._id,
    playerName: await auditPlayerLabel(ctx, registration),
  };
}

// Shapes a badge registration into the convention log's player reference.
export async function conventionAuditPlayerRef(
  ctx: MutationCtx,
  registration: Doc<"conventionRegistrations">,
) {
  return {
    registrationId: registration._id,
    playerName: await auditPlayerLabel(ctx, registration),
  };
}

// The player reference for a match-player row, whose stamped playerName dates
// from pairing time. A nameless row reads its registration to reach the
// organizer label; a named one reads nothing.
export async function auditMatchPlayerRef(
  ctx: MutationCtx,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  if (playerRow.playerName !== undefined) {
    return {
      registrationId: playerRow.playerId,
      playerName: playerRow.playerName,
    };
  }
  const registration = await ctx.db.get(playerRow.playerId);
  return {
    registrationId: playerRow.playerId,
    playerName: registration ? await auditPlayerLabel(ctx, registration) : null,
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
      participantId: Id<"participants">;
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
  const playerName = await auditPlayerLabel(ctx, args.registration);
  // One construction for both logs; generic over the per-table
  // registrationId each log's player ref demands.
  const eventWithPlayer = <RegistrationId>(registrationId: RegistrationId) => ({
    ...args.event,
    player: { registrationId, playerName },
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

// One side of a match result as captured in the log.
export async function auditResultLine(
  ctx: MutationCtx,
  playerRow: Doc<"tournamentMatchPlayers">,
  gameWins: number,
  gameLosses: number,
  gameDraws: number,
) {
  return {
    ...(await auditMatchPlayerRef(ctx, playerRow)),
    gameWins,
    gameLosses,
    gameDraws,
  };
}

// The result already on a match's player rows, for logging what an organizer
// override replaced. Null when the match had no result yet.
export async function existingResultLines(
  ctx: MutationCtx,
  match: Doc<"tournamentMatches">,
  playerRows: Doc<"tournamentMatchPlayers">[],
) {
  if (match.matchStatus !== "completed") {
    return null;
  }
  return await Promise.all(
    playerRows.map((row) =>
      auditResultLine(
        ctx,
        row,
        row.gameWins ?? 0,
        row.gameLosses ?? 0,
        row.gameDraws ?? 0,
      ),
    ),
  );
}
