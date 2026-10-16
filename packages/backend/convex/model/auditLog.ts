import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { parseMoneyRowEntry, parseMoneyRowOwner } from "./paidEventOwner";
import {
  registrationNameStamp,
  registrationOrganizerLabel,
} from "./registrations";
import type {
  conventionAuditEventValidator,
  tournamentAuditEventValidator,
} from "../validators";

export type TournamentAuditEvent = Infer<typeof tournamentAuditEventValidator>;
export type ConventionAuditEvent = Infer<typeof conventionAuditEventValidator>;

export type AuditActorRole = "organizer" | "player" | "system";

// The actor label of every append: the same name-then-email rule as the
// registration's organizerLabel stamp (registrationNameStamp), off the
// acting user the caller already holds. Player references never use this —
// they are labelled from a row's stamp (auditPlayerRefOf), so the label a
// player's own append stores matches the one an organizer's append stores
// for the same row.
function auditUserLabel(user: Doc<"users">): string | null {
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

// A row-shaped name stamp an audit label is read from: a registration or
// badge (both stamps), or a match-player row (the player-safe copy only).
type AuditLabelStamp = { playerName?: string; organizerLabel?: string };

// The label an audit row stores for a registration or badge: the row's
// organizer label — the account's name, or its email when it has none
// (registrationNameStamp). Both audit logs are organizer-only by access, so
// the email may be denormalized here; the player-safe playerName copies on
// standings, match players, and seats never carry it. Read straight off
// the row the caller already holds, so an append costs no extra read. Null
// for a row with neither stamp (an account with neither name nor email) and
// for a row that no longer exists.
function auditPlayerLabel(stamp: AuditLabelStamp | null): string | null {
  return stamp ? (registrationOrganizerLabel(stamp) ?? null) : null;
}

// The one constructor of the audit logs' player reference — the shape every
// player, players, and result arm of both event validators carries
// (auditPlayerRefValidator, conventionAuditPlayerRefValidator). Generic over
// the per-table registration id; every public ref below is this applied to
// whatever stamp its caller holds, so a change to the shape lands here once.
function auditPlayerRefOf<RegistrationId>(
  registrationId: RegistrationId,
  stamp: AuditLabelStamp | null,
) {
  return { registrationId, playerName: auditPlayerLabel(stamp) };
}

// Shapes a registration into the audit log's denormalized player reference.
export function auditPlayerRef(registration: Doc<"tournamentRegistrations">) {
  return auditPlayerRefOf(registration._id, registration);
}

// Shapes a badge registration into the convention log's player reference.
export function conventionAuditPlayerRef(
  registration: Doc<"conventionRegistrations">,
) {
  return auditPlayerRefOf(registration._id, registration);
}

// The player reference for a registration the acting user just stamped from
// their own account and holds only the id of (registerSelf, straight after
// the insert). Labelled through registrationNameStamp — the stamp the row
// was written with — so this ref and auditPlayerRef over the same row agree
// by construction rather than by two readings of the user document.
export function auditPlayerRefForUser(
  registrationId: Id<"tournamentRegistrations">,
  user: Doc<"users">,
) {
  return auditPlayerRefOf(registrationId, registrationNameStamp(user));
}

// The player reference for a match-player row, whose stamped playerName dates
// from pairing time. A nameless row reads its registration to reach the
// organizer label; a named one reads nothing.
export async function auditMatchPlayerRef(
  ctx: MutationCtx,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  const stamp =
    playerRow.playerName !== undefined
      ? playerRow
      : await ctx.db.get(playerRow.playerId);
  return auditPlayerRefOf(playerRow.playerId, stamp);
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
    registration: AuditLabelStamp & {
      _id: Id<"tournamentRegistrations"> | Id<"conventionRegistrations">;
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
    player: auditPlayerRefOf(registrationId, args.registration),
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
