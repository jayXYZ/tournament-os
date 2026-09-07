import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuditActorRole } from "./auditLog";
import { auditPlayerRef, logAuditEvent } from "./auditLog";
import {
  closeOpenOrdersForRegistration,
  settleOrdersOnEntryExit,
} from "../payments/refunds";
import {
  participantBadgeCompsChildEvent,
  resolveChildEventAdmission,
} from "./conventions";
import { inviteCodeGrantsAccess } from "./invites";
import { ensureParticipantForUser } from "./participants";
import { tiebreakRandom } from "./random";
import { concedeUnfinishedMatchOnDrop } from "./matchResults";
import { setRegistrationState } from "./participation";
import {
  ensurePostApprovalOrder,
  isPaidEvent,
  registrationHoldsPaidOrder,
} from "./payments";
import {
  adjustConfirmedRegistrationCount,
  playerDisplayName,
  registrationForUser,
  registrationApproveEffect,
  registrationCancelEffect,
  registrationDropEffect,
  registrationReinstateEffect,
  registrationRejectEffect,
  registrationWaitlistEffect,
  requireCapacityAvailable,
} from "./registrations";

// The roster workflow module: the named verbs that change who is in the
// event. Entry Status and Participation Status are independent (see
// CONTEXT.md), so the verbs come in two groups — the admission verbs
// (cancelEntry/restoreEntry plus the organizer review verbs approveEntry,
// rejectEntry, and waitlistEntry) move the entry state and the seat counter
// with it, while dropPlayer/reinstatePlayer move a confirmed player's
// competitive state. Together they give every supported entry state its
// write side: confirmed and cancelled flow through register/cancel/restore,
// and the review states route through the organizer verbs (approve confirms
// pending/waitlisted/rejected rows, reject declines applications or removes
// and bars players, waitlist holds a pending application). Pending rows are
// filed by registerSelf when the tournament requires registration approval;
// every transition out of every state lives here and is spec-covered. The
// remaining participation state, "disqualified", deliberately has no writer
// until the judge-operations DQ action.
//
// Each verb owns its eligibility per actor, the registration write (through
// setRegistrationState, which keeps the standings copy in step — see
// model/participation.ts), the audit event, and — for a drop — the
// Concession, in one enforced order. Endpoints stay thin adapters: they
// resolve auth, rate limits, and endpoint-specific error messages, then pass
// the actor. The organizer roster actions route here on the same effect
// projections (registrationDropEffect, registrationReinstateEffect, and the
// review-action counterparts in model/registrations.ts) the client renders
// its buttons from, so what an action offers and what its verb does can
// never diverge.

export type RosterTransitionArgs = {
  tournament: Doc<"tournaments">;
  registration: Doc<"tournamentRegistrations">;
  actor: Doc<"users">;
  actorRole: AuditActorRole;
};

// A player's exit from active play (see CONTEXT.md "Drop"): the seat is
// kept, the record freezes and keeps feeding former opponents' tiebreakers,
// and the player's own unfinished match in the open round is conceded. Who
// may drop differs by actor: a player drops themself only while active,
// while an organizer can also drop an eliminated player to record that they
// left — the elimination stamp survives (setRegistrationState keeps it, see
// its contract in model/participation.ts), so a later reinstate returns them
// to eliminated, never to active play.
export async function dropPlayer(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (tournament.lifecycle !== "in_progress") {
    throw new Error("Tournament is not in progress");
  }
  if (actorRole === "player") {
    if (
      registration.entryStatus !== "confirmed" ||
      registration.participationStatus !== "active"
    ) {
      throw new Error("Active registration not found");
    }
  } else if (
    registrationDropEffect(tournament.lifecycle, registration) !== "drop"
  ) {
    throw new Error("Registration cannot be dropped in its current state");
  }
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "confirmed",
    participationStatus: "dropped",
    updatedAt: Date.now(),
  });
  // The drop's audit event lands before the Concession applies its own, so
  // the log reads causally: player_dropped, then the match_conceded it
  // caused.
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: { type: "player_dropped", player: auditPlayerRef(registration) },
  });
  // A drop during the player's own unfinished match concedes it (see
  // CONTEXT.md "Concession"), recorded with the drop's actor.
  await concedeUnfinishedMatchOnDrop(ctx, {
    tournament,
    registration,
    actor,
    actorRole,
  });
}

// The way back from a drop. Reinstating undoes only the drop: a player who
// was already eliminated when they were dropped returns to eliminated, never
// to active play mid-bracket. Before play there is no bracket — a rewind
// back to registration deletes every round and clears the eliminations it
// preserved — so the restoration is always to active.
export async function reinstatePlayer(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (
    registrationReinstateEffect(tournament.lifecycle, registration) !==
    "reinstate"
  ) {
    throw new Error("Registration cannot be reinstated in its current state");
  }
  const now = Date.now();
  const eliminatedByRoundId =
    tournament.lifecycle === "in_progress"
      ? registration.eliminatedByRoundId
      : undefined;
  await setRegistrationState(
    ctx,
    registration._id,
    eliminatedByRoundId !== undefined
      ? {
          entryStatus: "confirmed",
          participationStatus: "eliminated",
          eliminatedByRoundId,
          tournamentStartDate: tournament.startDate,
          updatedAt: now,
        }
      : {
          entryStatus: "confirmed",
          participationStatus: "active",
          tournamentStartDate: tournament.startDate,
          updatedAt: now,
        },
  );
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: { type: "player_reinstated", player: auditPlayerRef(registration) },
  });
}

// Cancels an entry before play. For a confirmed seat the entry is cancelled
// and the seat count drops, and — because a cancelled row is the standing
// invitation back into a private event (see registerSelf) — the player can
// later re-register into it; dropped rows are accepted too, since a drop
// preserved by a round-one rewind still holds the player's seat. A pending
// or waitlisted application withdraws the same way but never held a seat, so
// the counter stays put. The rule is the same for both actors (the organizer
// roster's drop button simply never routes non-confirmed rows here — its
// review actions decline them instead).
export async function cancelEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (tournament.lifecycle !== "registration") {
    throw new Error("Tournament is not open for registration");
  }
  const cancelEffect = registrationCancelEffect(
    tournament.lifecycle,
    registration,
  );
  if (cancelEffect === null) {
    throw new Error("Active registration not found");
  }
  const now = Date.now();
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "cancelled",
    updatedAt: now,
  });
  if (cancelEffect === "release") {
    await adjustConfirmedRegistrationCount(ctx, tournament, -1, now);
  }
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: {
      type: "registration_cancelled",
      player: auditPlayerRef(registration),
    },
  });
  // Money follows the entry out: open orders close, and a paid one refunds
  // by whose decision this was (payments/refunds.ts).
  await settleOrdersOnEntryExit(ctx, {
    owner: { kind: "tournament", event: tournament },
    registration,
    actor,
    actorRole,
  });
}

// Restores a cancelled entry to a confirmed, active seat. Capacity applies:
// the cancellation released the seat, so retaking it competes with every
// registration since. On a paid event a seat moves only with its money: an
// entry whose payment left (or is leaving) with the cancellation re-enters
// "pending" alongside a payable order — approveEntry's payment arm — and
// the Checkout webhook seats it when the new payment lands. Only an entry
// whose order is still paid and unrefunded (a cancel past the refund
// window) reseats directly.
export async function restoreEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (
    registrationReinstateEffect(tournament.lifecycle, registration) !==
    "restore"
  ) {
    throw new Error("Registration cannot be reinstated in its current state");
  }
  requireCapacityAvailable(tournament);
  const now = Date.now();
  const holdsPaidOrder =
    isPaidEvent(tournament) &&
    (await registrationHoldsPaidOrder(ctx, registration._id));
  // A pass that comps this event reseats the entry free (ADR 0004), audited
  // as a comped entry; an entry whose own paid order still stands is a paid
  // reseat, not a comp.
  const compedByBadge =
    isPaidEvent(tournament) &&
    !holdsPaidOrder &&
    (await participantBadgeCompsChildEvent(
      ctx,
      tournament,
      registration.participantId,
    ));
  if (isPaidEvent(tournament) && !holdsPaidOrder && !compedByBadge) {
    await setRegistrationState(ctx, registration._id, {
      entryStatus: "pending",
      updatedAt: now,
    });
    const order = await ensurePostApprovalOrder(ctx, {
      tournament,
      registration,
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor,
      actorRole,
      event: {
        type: "player_reinstated",
        player: auditPlayerRef(registration),
      },
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor,
      actorRole,
      event: {
        type: "payment_requested",
        player: auditPlayerRef(registration),
        totalCents: order.amountBreakdown.totalCents,
      },
    });
    return;
  }
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "confirmed",
    participationStatus: "active",
    tournamentStartDate: tournament.startDate,
    updatedAt: now,
  });
  await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: {
      type: "player_reinstated",
      player: auditPlayerRef(registration),
      compedByBadge: compedByBadge || undefined,
    },
  });
}

// The organizer admits an entry: a pending application is confirmed, a
// waitlisted one is promoted, a rejected one has its rejection reversed —
// the sanctioned way back registerSelf's guard defers to. The approval takes
// a seat, so capacity applies exactly as it does to registerSelf and
// restoreEntry.
export async function approveEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (actorRole !== "organizer") {
    throw new Error("Only an organizer can approve a registration");
  }
  const approveEffect = registrationApproveEffect(
    tournament.lifecycle,
    registration,
  );
  if (approveEffect === null) {
    throw new Error("Registration cannot be approved in its current state");
  }
  requireCapacityAvailable(tournament);
  const now = Date.now();
  // On a paid event, approval requests payment instead of seating: the entry
  // (re)enters "pending" — no seat, no participation status — alongside a
  // payable order, and the Checkout webhook confirms the seat when the
  // payment lands (payments/webhooks.ts). Capacity was only a courtesy check
  // here; it is re-checked when the payment arrives. A participant whose
  // convention pass comps this event (ADR 0004) skips payment and seats
  // through the free arm below, audited as a comped entry.
  const compedByBadge =
    isPaidEvent(tournament) &&
    (await participantBadgeCompsChildEvent(
      ctx,
      tournament,
      registration.participantId,
    ));
  if (isPaidEvent(tournament) && !compedByBadge) {
    if (registration.entryStatus !== "pending") {
      await setRegistrationState(ctx, registration._id, {
        entryStatus: "pending",
        updatedAt: now,
      });
    }
    const order = await ensurePostApprovalOrder(ctx, {
      tournament,
      registration,
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor,
      actorRole,
      event: {
        type: "registration_approved",
        player: auditPlayerRef(registration),
        previousEntryStatus: approveEffect,
      },
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor,
      actorRole,
      event: {
        type: "payment_requested",
        player: auditPlayerRef(registration),
        totalCents: order.amountBreakdown.totalCents,
      },
    });
    return;
  }
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "confirmed",
    participationStatus: "active",
    tournamentStartDate: tournament.startDate,
    updatedAt: now,
  });
  await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: {
      type: "registration_approved",
      player: auditPlayerRef(registration),
      previousEntryStatus: approveEffect,
      compedByBadge: compedByBadge || undefined,
    },
  });
}

// The organizer rejects an entry: an application is declined, a confirmed
// player is removed (their seat released), or a cancelled row is barred from
// acting as a standing invitation back into the event (see
// registrationRejectEffect for the three arms). Whatever the arm, the row
// lands in "rejected" — which registerSelf refuses to re-enter — so the
// decision holds until approveEntry reverses it.
export async function rejectEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (actorRole !== "organizer") {
    throw new Error("Only an organizer can reject a registration");
  }
  const rejectEffect = registrationRejectEffect(
    tournament.lifecycle,
    registration,
  );
  // The entryStatus clause restates a refusal the effect already makes (a
  // rejected row has no reject arm) so previousEntryStatus carries the
  // narrow type the audit event admits.
  const { entryStatus: previousEntryStatus } = registration;
  if (rejectEffect === null || previousEntryStatus === "rejected") {
    throw new Error("Registration cannot be rejected in its current state");
  }
  const now = Date.now();
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "rejected",
    updatedAt: now,
  });
  if (rejectEffect === "remove") {
    await adjustConfirmedRegistrationCount(ctx, tournament, -1, now);
  }
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: {
      type: "registration_rejected",
      player: auditPlayerRef(registration),
      previousEntryStatus,
    },
  });
  // An organizer decision always makes the player whole: open orders close
  // and a paid one refunds in full, the organizer absorbing the fee
  // (payments/refunds.ts) — and it never flags the player.
  await settleOrdersOnEntryExit(ctx, {
    owner: { kind: "tournament", event: tournament },
    registration,
    actor,
    actorRole,
  });
}

// The organizer holds a pending application on the waitlist instead of
// deciding it. No seat is taken or released; the ways off the waitlist are
// approveEntry, rejectEntry, or the player's own withdrawal through
// cancelEntry.
export async function waitlistEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (actorRole !== "organizer") {
    throw new Error("Only an organizer can waitlist a registration");
  }
  if (
    registrationWaitlistEffect(tournament.lifecycle, registration) !==
    "waitlist"
  ) {
    throw new Error("Registration cannot be waitlisted in its current state");
  }
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "waitlisted",
    updatedAt: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole,
    event: {
      type: "registration_waitlisted",
      player: auditPlayerRef(registration),
    },
  });
  // A waitlisted entry must not stay payable: an open checkout completing
  // would only bounce off the webhook's seat check and auto-refund with the
  // processing fee eaten. The hold closes the order; a later approval mints
  // a fresh one (ensurePostApprovalOrder).
  await closeOpenOrdersForRegistration(ctx, registration._id);
}

// What finding an existing registration row means for a new registerSelf
// attempt, per entry status: the error that blocks it, or null for
// "cancelled" — the one state whose released seat the re-registration path
// reuses. The review-flow states (pending/waitlisted/rejected) each get
// their own honest message rather than a blanket "Already registered": a
// pending or waitlisted row is a live application a second submission would
// duplicate, and a rejected row records an organizer decision that silently
// re-registering would overturn with one click — the way back from a
// rejection is approveEntry (the organizer reversal in model/roster.ts),
// never this mutation quietly stamping the entry confirmed.
function existingEntryBlocksRegistration(
  entryStatus: Doc<"tournamentRegistrations">["entryStatus"],
): string | null {
  switch (entryStatus) {
    case "confirmed":
      return "Already registered";
    case "pending":
      return "Your registration is pending review";
    case "waitlisted":
      return "You are on the waitlist for this event";
    case "rejected":
      return "Your registration was declined";
    case "cancelled":
      return null;
    default:
      // A new entry status must decide what registerSelf does with it: the
      // `satisfies never` fails the build until this switch handles it, and
      // this throw catches a rogue runtime value.
      throw new Error(
        `Unhandled registration entry status: ${entryStatus satisfies never}`,
      );
  }
}

export async function registerPlayer(
  ctx: MutationCtx,
  {
    tournament,
    user,
    inviteCode,
  }: {
    tournament: Doc<"tournaments">;
    user: Doc<"users">;
    inviteCode?: string;
  },
): Promise<Id<"tournamentRegistrations">> {
  const existing = await registrationForUser(ctx, tournament._id, user._id);
  // A private event takes no registrations off the public page. Two grants
  // get past that: the event's invite code, which is the organizer's way of
  // letting new players in at all — and an existing row, because a player
  // who already holds one was admitted once and still resolves the event's
  // code, so cancelling is not a one-way door out of an invite-only event:
  // the cancelled row is the standing invitation that lets them back in.
  // Nothing else slips through — every other entry status is rejected just
  // below (the invite code included: it grants entry, it never overturns an
  // entry decision such as a rejection), so a live row can only ever
  // re-enter the event it belongs to.
  if (
    tournament.lifecycle !== "registration" ||
    (tournament.visibility === "private" &&
      existing === null &&
      !(await inviteCodeGrantsAccess(ctx, tournament, inviteCode)))
  ) {
    throw new Error("Tournament is not open for registration");
  }
  // A badge-gated child event admits self-registration only with a
  // confirmed convention badge (model/conventions.ts). Organizer verbs
  // (approve, guest enroll) bypass the gate by never routing here.
  const childAdmission = await resolveChildEventAdmission(
    ctx,
    tournament,
    user._id,
  );
  // Direct registration on a paid event goes through the Checkout action
  // (payments/checkout.ts), which files the pending row itself; the seat
  // is only ever taken by the payment webhook. Approval-mode paid events
  // still file their free application here — payment is requested at
  // approval. A player whose convention pass comps this event (ADR 0004)
  // registers free right here: no order is ever created for them, and the
  // audit row records the comp.
  const compedByBadge =
    isPaidEvent(tournament) &&
    !tournament.registrationRequiresApproval &&
    childAdmission.compedByBadge;
  if (
    isPaidEvent(tournament) &&
    !tournament.registrationRequiresApproval &&
    !compedByBadge
  ) {
    throw new Error(
      "This event charges an entry fee — register through the payment checkout",
    );
  }

  if (existing) {
    const blockedBecause = existingEntryBlocksRegistration(
      existing.entryStatus,
    );
    if (blockedBecause !== null) {
      throw new Error(blockedBecause);
    }
  }

  // Applications are capacity-gated like direct registrations: a full
  // event takes no more entries in either mode. (Accepting applications
  // past capacity — or auto-waitlisting them — is the waitlist-promotion
  // work, not a side effect of the approval toggle.)
  requireCapacityAvailable(tournament);
  // Under organizer approval the row enters as a "pending" application —
  // no seat taken, no participation status — and the entry-review verbs
  // decide it. Re-registering a cancelled row files a fresh application
  // the same way: a released seat is no shortcut past review. One
  // admission shape serves the fresh insert and the reused row alike.
  const requiresApproval = tournament.registrationRequiresApproval;
  const admission = requiresApproval
    ? { entryStatus: "pending" as const }
    : {
        entryStatus: "confirmed" as const,
        participationStatus: "active" as const,
      };
  const now = Date.now();
  const playerName = playerDisplayName(user);
  const participant = await ensureParticipantForUser(ctx, user._id);
  const registrationId =
    existing?._id ??
    (await ctx.db.insert("tournamentRegistrations", {
      tournamentId: tournament._id,
      participantId: participant._id,
      tournamentStartDate: tournament.startDate,
      ...admission,
      playerName,
      createdAt: now,
      tiebreakRandom: tiebreakRandom(
        tournament.seed ?? tournament.publicCode,
        String(user.publicCode),
      ),
      updatedAt: now,
    }));
  if (existing) {
    await setRegistrationState(ctx, existing._id, {
      ...admission,
      playerName,
      tournamentStartDate: tournament.startDate,
      updatedAt: now,
    });
  }
  if (!requiresApproval) {
    await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
  }
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "player",
    event: requiresApproval
      ? {
          type: "registration_requested",
          player: { registrationId, playerName: playerName ?? null },
        }
      : {
          type: "player_registered",
          player: { registrationId, playerName: playerName ?? null },
          compedByBadge: compedByBadge || undefined,
        },
  });
  return registrationId;
}
