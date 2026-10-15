import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { parseMoneyRowEntry, parseMoneyRowOwner } from "./paidEventOwner";
import { registrationOrganizerLabel } from "./registrations";
import type {
  conventionAuditEventValidator,
  tournamentAuditEventValidator,
} from "../validators";

export type TournamentAuditEvent = Infer<typeof tournamentAuditEventValidator>;
export type ConventionAuditEvent = Infer<typeof conventionAuditEventValidator>;

export type AuditActorRole = "organizer" | "player" | "system";

// The organizer label for an account the caller already holds: the same
// name-then-email rule as the registration's organizerLabel stamp
// (registrationNameStamp), with no read. Used for the actor of every append
// and for the player reference when the registrant is acting on their own
// entry (registering, cancelling, submitting a decklist), where the acting
// user is the player.
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
    // (unlike the playerName stamp, whose copies reach other players).
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

// The label an audit row stores for a registration or badge: the row's
// organizer label — the account's name, or its email when it has none
// (registrationNameStamp). Both audit logs are organizer-only by access, so
// the email may be denormalized here; the player-safe playerName copies on
// standings, match players, and seats never carry it. Read straight off
// the row the caller already holds, so an append costs no extra read. Null
// only for a row with neither stamp (an account with neither name nor
// email).
function auditPlayerLabel(registration: {
  playerName?: string;
  organizerLabel?: string;
}): string | null {
  return registrationOrganizerLabel(registration) ?? null;
}

// Shapes a registration into the audit log's denormalized player reference.
export function auditPlayerRef(registration: Doc<"tournamentRegistrations">) {
  return {
    registrationId: registration._id,
    playerName: auditPlayerLabel(registration),
  };
}

// Shapes a badge registration into the convention log's player reference.
export function conventionAuditPlayerRef(
  registration: Doc<"conventionRegistrations">,
) {
  return {
    registrationId: registration._id,
    playerName: auditPlayerLabel(registration),
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
    playerName: registration ? auditPlayerLabel(registration) : null,
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
      organizerLabel?: string;
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
  const playerName = auditPlayerLabel(args.registration);
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
