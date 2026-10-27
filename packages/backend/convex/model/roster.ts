import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuditActorRole } from "./auditLog";
import {
  auditPlayerRef,
  auditPlayerRefForStamp,
  auditPlayerRefForUser,
  logAuditEvent,
} from "./auditLog";
import {
  closeOpenOrdersForRegistration,
  settleOrdersOnEntryExit,
} from "../payments/refunds";
import {
  participantBadgeCompsChildEvent,
  resolveChildEventAdmission,
} from "./conventions";
import { userError } from "./errors";
import { inviteCodeGrantsAccess } from "./invites";
import { concedeUnfinishedMatchOnDrop } from "./matchResults";
import {
  claimGuestEntryInTournament,
  createGuestParticipant,
  ensureParticipantForUser,
  guestParticipantForEmail,
  isGuestParticipant,
  participantForUser,
  requireParticipant,
} from "./participants";
import { setRegistrationState } from "./participation";
import {
  ensurePostApprovalOrder,
  isPaidEvent,
  registrationHoldsPaidOrder,
} from "./payments";
import {
  type RegistrationNameStamp,
  adjustConfirmedRegistrationCount,
  registrationApproveEffect,
  registrationCancelEffect,
  registrationDropEffect,
  registrationHasUsableName,
  registrationNameEffect,
  registrationOrganizerLabel,
  registrationReinstateEffect,
  registrationRejectEffect,
  registrationForParticipant,
  registrationForUser,
  registrationNameStamp,
  registrationWaitlistEffect,
  requireCapacityAvailable,
  restampRegistrationRow,
} from "./registrations";
import { tiebreakRandom } from "./random";
import { userByEmail } from "./users";
import { normalizeEmail, presentText } from "../validators";

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
// filed by registerEntry when the tournament requires registration approval;
// every transition out of every state lives here and is spec-covered. The
// second way into a confirmed seat is the organizer's own enrollment —
// enrollPlayerByEmail and addGuest, which seat a player without the player
// registering (CONTEXT.md "Enrollment") — with continueAsGuest naming an
// enrolled entry that still awaits player details. The remaining
// participation state, "disqualified", deliberately has no writer until the
// judge-operations DQ action.
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
    throw userError("Tournament is not in progress");
  }
  if (actorRole === "player") {
    if (
      registration.entryStatus !== "confirmed" ||
      registration.participationStatus !== "active"
    ) {
      throw userError("Active registration not found");
    }
  } else if (
    registrationDropEffect(tournament.lifecycle, registration) !== "drop"
  ) {
    throw userError("Registration cannot be dropped in its current state");
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
    event: {
      type: "player_dropped",
      player: auditPlayerRef(registration),
    },
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
    throw userError("Registration cannot be reinstated in its current state");
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
    event: {
      type: "player_reinstated",
      player: auditPlayerRef(registration),
    },
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
    throw userError("Tournament is not open for registration");
  }
  const cancelEffect = registrationCancelEffect(
    tournament.lifecycle,
    registration,
  );
  if (cancelEffect === null) {
    throw userError("Active registration not found");
  }
  const now = Date.now();
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "cancelled",
    updatedAt: now,
  });
  await dropOrganizerNameFromAccountEntry(ctx, registration, now);
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

// An organizer's name for an entry ("Continue as guest", organizerNamed)
// labels a Guest's entry for one event, and the Claim keeps it on the live
// entry it hands to an account (CONTEXT.md "Claim"). It ends with the
// entry: organizers name guests, not account holders, so once an account
// holder's entry is cancelled — here — or re-entered by the player
// (registerEntry, the checkout) the label is dropped and the account's own
// name takes over, which the sign-in re-stamp then keeps current. A Guest's
// cancelled entry keeps its name: it has no other, and the organizer who
// reinstates it should not have to name it again.
async function dropOrganizerNameFromAccountEntry(
  ctx: MutationCtx,
  registration: Doc<"tournamentRegistrations">,
  now: number,
): Promise<void> {
  if (!registration.organizerNamed) {
    return;
  }
  const participant = await ctx.db.get(registration.participantId);
  const user =
    participant?.userId === undefined
      ? null
      : await ctx.db.get(participant.userId);
  if (!user) {
    return;
  }
  await restampRegistrationRow(
    ctx,
    registration,
    registrationNameStamp(user),
    now,
    { organizerNamed: undefined },
  );
}

// Whether re-admitting an entry skips the entry-fee order: an organizer
// enrolled it (the exemption persists on the row through Claims), or its
// holder is a guest with no account to pay from.
async function entrySettlesFeeOutsideApp(
  ctx: MutationCtx,
  registration: Doc<"tournamentRegistrations">,
): Promise<boolean> {
  return (
    registration.entryFeeExempt === true ||
    (await isGuestParticipant(ctx, registration.participantId))
  );
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
    throw userError("Registration cannot be reinstated in its current state");
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
  // An enrolled entry (entryFeeExempt) reseats through the free arm like a
  // comped one: the organizer who enrolled it settles any fee outside the
  // app, and that holds after the Claim hands the entry to an account. A
  // guest has no account to pay from (createEntryOrder refuses one), so any
  // guest's entry — a test player's included — takes the free arm too.
  const payable =
    isPaidEvent(tournament) &&
    !holdsPaidOrder &&
    !compedByBadge &&
    !(await entrySettlesFeeOutsideApp(ctx, registration));
  if (payable) {
    await setRegistrationState(ctx, registration._id, {
      entryStatus: "pending",
      awaitingReview: false,
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
    throw userError("Registration cannot be approved in its current state");
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
  // An enrolled entry, or any guest's, seats through the free arm like a
  // comped one — the fee, if any, is the organizer's to settle at the door
  // (entrySettlesFeeOutsideApp).
  const payable =
    isPaidEvent(tournament) &&
    !compedByBadge &&
    !(await entrySettlesFeeOutsideApp(ctx, registration));
  if (payable) {
    // The decision is made, so the row leaves the review queue even though
    // its entry status stays "pending" for the payment — the same write
    // whether the row was an undecided application or a waitlisted/rejected
    // row re-entering "pending".
    await setRegistrationState(ctx, registration._id, {
      entryStatus: "pending",
      awaitingReview: false,
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
    throw userError("Registration cannot be rejected in its current state");
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
    throw userError("Registration cannot be waitlisted in its current state");
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
// attempt (registerEntry), per entry status: the error that blocks it, or null for
// "cancelled" — the one state whose released seat the re-registration path
// reuses. The review-flow states (pending/waitlisted/rejected) each get
// their own honest message rather than a blanket "Already registered": a
// pending or waitlisted row is a live application a second submission would
// duplicate, and a rejected row records an organizer decision that silently
// re-registering would overturn with one click — the way back from a
// rejection is approveEntry (the organizer reversal above), never this
// verb quietly stamping the entry confirmed.
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

// A signed-in player's own entry into the event (the registerSelf endpoint):
// a confirmed seat, or — under organizer approval — a pending application
// for the Review Queue. Owns the entry gates (lifecycle, the private-event
// grants, the badge gate, the paid-event checkout redirect, capacity), the
// registration write, the seat counter, and the audit event.
//
// An entry the organizer enrolled for this player (CONTEXT.md "Enrollment")
// is the player's own entry in the event, and the Claim is how they come to
// hold it. Two Claims can reach it from here: the sign-in's, which ran just
// before this (claimedBySignIn is what it moved), and the targeted one for
// a guest the sign-in's could not merge whole — a history too long for one
// transaction, or a collision in another event
// (claimGuestEntryInTournament). Without the latter, this verb would file
// a second entry for the same person beside the guest's, and the seat it
// filed would be the collision that then keeps the guest unclaimed for
// good. A confirmed entry either Claim hands the player in this call is
// returned as their registration: nothing is left to file, and refusing it
// as "already registered" would roll the Claim back with the refusal,
// leaving the player unlinked from a seat they hold. Any other entry the
// Claim hands over is the row this verb acts on, exactly as a row the
// account held already — re-entering a cancelled one, refusing the rest.
export async function registerEntry(
  ctx: MutationCtx,
  {
    tournament,
    user,
    inviteCode,
    claimedBySignIn,
  }: {
    tournament: Doc<"tournaments">;
    user: Doc<"users">;
    inviteCode?: string;
    claimedBySignIn: Id<"tournamentRegistrations">[];
  },
): Promise<Id<"tournamentRegistrations">> {
  const now = Date.now();
  const held = await registrationForUser(ctx, tournament._id, user._id);
  const claimed =
    held === null
      ? await claimGuestEntryInTournament(ctx, {
          user,
          tournamentId: tournament._id,
          now,
        })
      : claimedBySignIn.includes(held._id)
        ? held
        : null;
  if (claimed?.entryStatus === "confirmed") {
    return claimed._id;
  }
  const existing = held ?? claimed;
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
    throw userError("Tournament is not open for registration");
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
    throw userError(
      "This event charges an entry fee — register through the payment checkout",
    );
  }

  if (existing) {
    const blockedBecause = existingEntryBlocksRegistration(
      existing.entryStatus,
    );
    if (blockedBecause !== null) {
      throw userError(blockedBecause);
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
    ? { entryStatus: "pending" as const, awaitingReview: true as const }
    : {
        entryStatus: "confirmed" as const,
        participationStatus: "active" as const,
      };
  const nameStamp = registrationNameStamp(user);
  const participant = await ensureParticipantForUser(ctx, user._id);
  const registrationId =
    existing?._id ??
    (await ctx.db.insert("tournamentRegistrations", {
      tournamentId: tournament._id,
      participantId: participant._id,
      tournamentStartDate: tournament.startDate,
      ...admission,
      ...nameStamp,
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
      ...nameStamp,
      // A player's own re-entry is under the event's ordinary terms and
      // under the player's own name: an earlier enrollment's fee exemption
      // does not carry over, and neither does the name an organizer gave
      // the entry (dropOrganizerNameFromAccountEntry) — the account's name
      // is stamped above, and the sign-in re-stamp keeps it current.
      entryFeeExempt: undefined,
      organizerNamed: undefined,
      tournamentStartDate: tournament.startDate,
      updatedAt: now,
    });
  }
  if (!requiresApproval) {
    await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
  }
  // The registrant is the player: labelled from the stamp the row was just
  // written with, without reading the row back.
  const player = auditPlayerRefForUser(registrationId, user);
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "player",
    event: requiresApproval
      ? { type: "registration_requested", player }
      : {
          type: "player_registered",
          player,
          compedByBadge: compedByBadge || undefined,
        },
  });
  return registrationId;
}

// Longest organizer-typed player name: the stamp is copied onto every
// standings row, match player, and seat the entry appears in.
export const MAX_ENROLLMENT_NAME_LENGTH = 80;

// The name an organizer types for an entry ("Add guest", "Continue as
// guest"): trimmed, present, and within the stamp's length — it is the
// player-safe stamp every player-facing row will carry.
function requireEnrollmentName(raw: string): string {
  const displayName = presentText(raw);
  if (displayName === undefined) {
    throw userError("Enter the player's name");
  }
  if (displayName.length > MAX_ENROLLMENT_NAME_LENGTH) {
    throw userError(
      `Player name must be ${MAX_ENROLLMENT_NAME_LENGTH} characters or fewer`,
    );
  }
  return displayName;
}

// What finding an existing row for the enrolled identity means for an
// organizer enrollment, per entry status: the refusal, written for the
// organizer and naming the roster action that admits the player instead, or
// null for "cancelled" — the one state whose released seat is simply
// retaken, exactly as registerEntry re-enters a cancelled row. The review
// states are refused rather than silently confirmed so every review
// decision still goes through its own verb and audit event: approveEntry
// is the one way a pending, waitlisted, or rejected row becomes a seat. The
// refusals never name the player: an email enrollment that collides with a
// row already on the roster says only that, so the enrollment form is not
// a way to learn whose email an entry is.
function existingEntryBlocksEnrollment(
  entryStatus: Doc<"tournamentRegistrations">["entryStatus"],
): string | null {
  switch (entryStatus) {
    case "confirmed":
      return "This player is already registered";
    case "pending":
      return "This player already has a pending registration — approve it from their row instead";
    case "waitlisted":
      return "This player is on the waitlist — approve their registration to seat them";
    case "rejected":
      return "This player's registration was declined — approve it from their row to re-admit them";
    case "cancelled":
      return null;
    default:
      throw new Error(
        `Unhandled registration entry status: ${entryStatus satisfies never}`,
      );
  }
}

// The row an enrollment lands on: the identity's cancelled row in this
// tournament, to be re-entered with its seat retaken, or null for a fresh
// insert. Every other entry status refuses (existingEntryBlocksEnrollment).
async function enrollmentRowFor(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  participantId: Id<"participants">,
): Promise<Doc<"tournamentRegistrations"> | null> {
  const existing = await registrationForParticipant(
    ctx,
    tournament._id,
    participantId,
  );
  if (existing) {
    const blockedBecause = existingEntryBlocksEnrollment(existing.entryStatus);
    if (blockedBecause !== null) {
      throw userError(blockedBecause);
    }
  }
  return existing;
}

// The gates every organizer enrollment keeps (CONTEXT.md "Enrollment"):
// registration must be open, and the seat it takes must exist. Checked
// before any identity is resolved or minted.
function requireEnrollmentOpen(tournament: Doc<"tournaments">) {
  if (tournament.lifecycle !== "registration") {
    throw userError("Tournament is not open for registration");
  }
  requireCapacityAvailable(tournament);
}

// The shared seat-taking tail of both enrollments: the admission write, the
// seat counter, and the audit event. The enrollment is the admission
// decision, so the row is confirmed and active whatever the event's approval
// mode, and the fee exemption rides on the row (schema entryFeeExempt) so a
// later reinstatement or re-approval keeps the enrollment's payment
// treatment whoever then holds the entry. A fresh row carries the stamps
// and flags given; a re-entered cancelled row keeps the stamps it has — an
// account's current ones, or the name an organizer already gave it here.
async function seatEnrolledEntry(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    actor: Doc<"users">;
    participant: Doc<"participants">;
    existing: Doc<"tournamentRegistrations"> | null;
    nameStamp: RegistrationNameStamp;
    organizerNamed: true | undefined;
    // Keyed on the identity's stable handle — an account's publicCode, as
    // registerEntry keys it, or the guest's participant id — so the
    // tiebreaker is reproducible across reseeds (model/random.ts).
    tiebreakKey: string;
    by: "email" | "name";
  },
): Promise<Id<"tournamentRegistrations">> {
  const { tournament, actor, participant, existing, nameStamp } = args;
  const now = Date.now();
  const admission = {
    entryStatus: "confirmed" as const,
    participationStatus: "active" as const,
    entryFeeExempt: true as const,
  };
  let registrationId: Id<"tournamentRegistrations">;
  if (existing) {
    registrationId = existing._id;
    await setRegistrationState(ctx, existing._id, {
      ...admission,
      tournamentStartDate: tournament.startDate,
      updatedAt: now,
    });
  } else {
    registrationId = await ctx.db.insert("tournamentRegistrations", {
      tournamentId: tournament._id,
      participantId: participant._id,
      tournamentStartDate: tournament.startDate,
      ...admission,
      ...nameStamp,
      organizerNamed: args.organizerNamed,
      createdAt: now,
      tiebreakRandom: tiebreakRandom(
        tournament.seed ?? tournament.publicCode,
        args.tiebreakKey,
      ),
      updatedAt: now,
    });
  }
  await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole: "organizer",
    event: {
      type: "player_enrolled",
      player: existing
        ? auditPlayerRef(existing)
        : auditPlayerRefForStamp(registrationId, nameStamp),
      by: args.by,
    },
  });
  return registrationId;
}

// "Enroll player": an organizer seats a player by email alone (CONTEXT.md
// "Enrollment"). The entry is confirmed and takes its seat at once, but it
// has no name yet — it awaits player details (CONTEXT.md "Awaiting Player
// Details") until the player signs in with a usable name or the organizer
// names them (continueAsGuest) — and play cannot start while it has none.
//
// The entry is seated on the Guest keyed by the email — the one already
// carrying it (guestParticipantForEmail), so a regular enrolled across
// several events stays one Participant with one history and one Claim, or
// a new one — whether or not an account holds the email. An account holder
// is deliberately not linked here: linking at enrollment would tell the
// organizer, through the entry's name and avatar, that the address has an
// account, so every email enrollment starts in the same state and the Claim
// links the account the next time its holder uses the app. The one place
// the account is consulted is registration uniqueness: if the account
// already holds a row in this event, that row is what the enrollment acts
// on (re-entering a cancelled one, refusing every other status), exactly as
// the Guest's own row would be — two entries for one person in one event is
// what neither this verb nor the Claim will create. An address two cached
// accounts still share has no certain owner (userByEmail), so only the
// Guest's row is checked and the Claim sorts out the holder at sign-in.
//
// Like the other organizer verbs it bypasses the invite and badge gates by
// never routing through registerEntry; capacity and the registration
// lifecycle still apply.
export async function enrollPlayerByEmail(
  ctx: MutationCtx,
  {
    tournament,
    actor,
    email: rawEmail,
  }: {
    tournament: Doc<"tournaments">;
    actor: Doc<"users">;
    email: string;
  },
): Promise<Id<"tournamentRegistrations">> {
  const presentEmail = presentText(rawEmail);
  if (presentEmail === undefined) {
    throw userError("Enter the player's email address");
  }
  const email = normalizeEmail(presentEmail);
  if (!email.includes("@")) {
    throw userError("Enter a valid email address");
  }
  requireEnrollmentOpen(tournament);

  const user = await userByEmail(ctx, email);
  if (user) {
    const accountParticipant = await participantForUser(ctx, user._id);
    const accountRow = accountParticipant
      ? await enrollmentRowFor(ctx, tournament, accountParticipant._id)
      : null;
    if (accountParticipant && accountRow) {
      return await seatEnrolledEntry(ctx, {
        tournament,
        actor,
        participant: accountParticipant,
        existing: accountRow,
        nameStamp: registrationNameStamp(user),
        organizerNamed: undefined,
        tiebreakKey: String(user.publicCode),
        by: "email",
      });
    }
  }

  const participant =
    (await guestParticipantForEmail(ctx, email)) ??
    (await requireParticipant(
      ctx,
      await createGuestParticipant(ctx, { contactEmail: email }),
    ));
  const existing = await enrollmentRowFor(ctx, tournament, participant._id);
  return await seatEnrolledEntry(ctx, {
    tournament,
    actor,
    participant,
    existing,
    // No name yet: the organizer label is the email, the player-safe stamp
    // absent, so organizer surfaces can identify the entry and nothing
    // player-facing ever shows the address.
    nameStamp: registrationNameStamp({ email }),
    organizerNamed: undefined,
    tiebreakKey: String(participant._id),
    by: "email",
  });
}

// "Add guest": an organizer seats a player by name alone (CONTEXT.md
// "Enrollment"). A fresh Guest every time — without an email there is
// nothing to deduplicate on and nothing to claim — confirmed, seated, and
// ready to play: the typed name is the entry's name for this event
// (organizerNamed) and the guest's display name.
export async function addGuest(
  ctx: MutationCtx,
  {
    tournament,
    actor,
    displayName: rawDisplayName,
  }: {
    tournament: Doc<"tournaments">;
    actor: Doc<"users">;
    displayName: string;
  },
): Promise<Id<"tournamentRegistrations">> {
  const displayName = requireEnrollmentName(rawDisplayName);
  requireEnrollmentOpen(tournament);
  const participant = await requireParticipant(
    ctx,
    await createGuestParticipant(ctx, { displayName }),
  );
  return await seatEnrolledEntry(ctx, {
    tournament,
    actor,
    participant,
    existing: null,
    nameStamp: registrationNameStamp({ name: displayName }),
    organizerNamed: true,
    tiebreakKey: String(participant._id),
    by: "name",
  });
}

// "Continue as guest": an organizer names an entry still awaiting player
// details, for this event (CONTEXT.md "Awaiting Player Details"). The name
// goes on the registration — the same row, seat, history, and fee
// treatment — as the event's label for the entrant (organizerNamed), so
// the sign-in re-stamp and the Claim leave it alone and no other event's
// entry for the same person is renamed. The participant is untouched: a
// guest keeps its contact email for a later Claim, an account stays linked.
// Only an entry without a usable name can be named here (registrationName-
// Effect): this is not a general rename.
export async function continueAsGuest(
  ctx: MutationCtx,
  {
    tournament,
    registration,
    actor,
    displayName: rawDisplayName,
  }: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
    actor: Doc<"users">;
    displayName: string;
  },
): Promise<void> {
  const displayName = requireEnrollmentName(rawDisplayName);
  if (registrationNameEffect(tournament.lifecycle, registration) !== "name") {
    throw userError(
      registrationHasUsableName(registration)
        ? "This player already has a name"
        : "Tournament is no longer accepting roster changes",
    );
  }
  const now = Date.now();
  const nameStamp = registrationNameStamp({ name: displayName });
  await restampRegistrationRow(ctx, registration, nameStamp, now, {
    organizerNamed: true,
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor,
    actorRole: "organizer",
    event: {
      type: "player_named",
      player: auditPlayerRefForStamp(registration._id, nameStamp),
      previousLabel: registrationOrganizerLabel(registration) ?? null,
    },
  });
}
