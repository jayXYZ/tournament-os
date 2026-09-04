import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  auditPlayerRef,
  conventionAuditPlayerRef,
  logAuditEvent,
  logConventionAuditEvent,
} from "./auditLog";
import { setBadgeEntryStatus } from "./conventions";
import { parseMoneyRowEntry, parseMoneyRowOwner } from "./paidEventOwner";
import { setRegistrationState } from "./participation";
import type { PaidEventRef } from "./payments";
import {
  adjustConfirmedRegistrationCount,
  hasCapacityAvailable,
} from "./registrations";
import {
  adjustTicketTypeConfirmedCount,
  hasTicketTypeCapacity,
} from "./ticketTypes";

// The seam that resolves a money row back to the paid event and entry row it
// belongs to, and performs the webhook's per-entity seat operations. The
// owner-pair decoding lives in model/paidEventOwner.ts (the one validated
// parser); these helpers add the document reads on top.

export type PaidEntryRef =
  | { kind: "tournament"; registration: Doc<"tournamentRegistrations"> }
  | { kind: "convention"; registration: Doc<"conventionRegistrations"> };

type OwnedMoneyRow = {
  tournamentId?: Id<"tournaments">;
  conventionId?: Id<"conventions">;
};

export async function paidEventForOrder(
  ctx: QueryCtx,
  order: OwnedMoneyRow,
): Promise<PaidEventRef | null> {
  const owner = parseMoneyRowOwner(order);
  if (owner.kind === "convention") {
    const convention = await ctx.db.get(owner.conventionId);
    return convention ? { kind: "convention", event: convention } : null;
  }
  const tournament = await ctx.db.get(owner.tournamentId);
  return tournament ? { kind: "tournament", event: tournament } : null;
}

export async function registrationForOrder(
  ctx: QueryCtx,
  order: OwnedMoneyRow & {
    registrationId:
      | Id<"tournamentRegistrations">
      | Id<"conventionRegistrations">;
  },
): Promise<PaidEntryRef | null> {
  const entry = parseMoneyRowEntry(order);
  if (entry.kind === "convention") {
    const registration = await ctx.db.get(entry.registrationId);
    return registration ? { kind: "convention", registration } : null;
  }
  const registration = await ctx.db.get(entry.registrationId);
  return registration ? { kind: "tournament", registration } : null;
}

// Whether a completed payment may seat its entry right now: registration
// open, the entry still pending (awaiting exactly this payment), and a seat
// left — for a badge, in both the convention's global capacity and the
// ticket type's own (a type selling out mid-checkout refunds the loser via
// seat_unavailable, same as a full event). The type's sale window is
// deliberately NOT re-checked here: it gates beginning a purchase, and an
// async payment begun inside the window may seat after it closes.
export async function isEntrySeatable(
  ctx: QueryCtx,
  owner: PaidEventRef,
  entry: PaidEntryRef,
) {
  if (
    owner.event.lifecycle !== "registration" ||
    entry.registration.entryStatus !== "pending" ||
    !hasCapacityAvailable(owner.event)
  ) {
    return false;
  }
  if (entry.kind === "convention") {
    const ticketType = await ctx.db.get(entry.registration.ticketTypeId);
    if (!ticketType || !hasTicketTypeCapacity(ticketType)) {
      return false;
    }
  }
  return true;
}

// Seats a paid entry: confirm, take a seat, and log the entity's
// "registered" event with the payer as actor when known. The webhook calls
// this only after isEntrySeatable.
export async function confirmPaidEntry(
  ctx: MutationCtx,
  args: {
    owner: PaidEventRef;
    entry: PaidEntryRef;
    payer: Doc<"users"> | null;
    now: number;
  },
) {
  const actorArgs = args.payer
    ? { actor: args.payer, actorRole: "player" as const }
    : { actorRole: "system" as const };
  if (args.owner.kind === "tournament" && args.entry.kind === "tournament") {
    await setRegistrationState(ctx, args.entry.registration._id, {
      entryStatus: "confirmed",
      participationStatus: "active",
      tournamentStartDate: args.owner.event.startDate,
      updatedAt: args.now,
    });
    await adjustConfirmedRegistrationCount(ctx, args.owner.event, 1, args.now);
    await logAuditEvent(ctx, {
      tournamentId: args.owner.event._id,
      ...actorArgs,
      event: {
        type: "player_registered",
        player: auditPlayerRef(args.entry.registration),
      },
    });
    return;
  }
  if (args.owner.kind === "convention" && args.entry.kind === "convention") {
    await setBadgeEntryStatus(ctx, args.entry.registration._id, {
      entryStatus: "confirmed",
      updatedAt: args.now,
    });
    await adjustConfirmedRegistrationCount(ctx, args.owner.event, 1, args.now);
    // The type's counter moves with the convention's — the isEntrySeatable
    // check just proved the type still had room.
    const ticketType = await ctx.db.get(args.entry.registration.ticketTypeId);
    if (ticketType) {
      await adjustTicketTypeConfirmedCount(ctx, ticketType, 1, args.now);
    }
    await logConventionAuditEvent(ctx, {
      conventionId: args.owner.event._id,
      ...actorArgs,
      event: {
        type: "badge_registered",
        player: conventionAuditPlayerRef(args.entry.registration),
      },
    });
    return;
  }
  throw new Error("Order owner and registration tables disagree");
}

// Withdraws a pending entry whose payment could not seat it (or whose
// session closed unpaid): back to "cancelled", the reusable state. Never
// touches a seat — a pending entry never held one.
export async function withdrawPendingEntry(
  ctx: MutationCtx,
  entry: PaidEntryRef,
  now: number,
) {
  if (entry.registration.entryStatus !== "pending") {
    return;
  }
  if (entry.kind === "tournament") {
    await setRegistrationState(ctx, entry.registration._id, {
      entryStatus: "cancelled",
      updatedAt: now,
    });
    return;
  }
  await setBadgeEntryStatus(ctx, entry.registration._id, {
    entryStatus: "cancelled",
    updatedAt: now,
  });
}
