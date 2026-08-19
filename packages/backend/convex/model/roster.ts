import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuditActorRole } from "./auditLog";
import { auditPlayerRef, logAuditEvent } from "./auditLog";
import { concedeUnfinishedMatchOnDrop } from "./matchResults";
import { setRegistrationState } from "./participation";
import {
  adjustConfirmedRegistrationCount,
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
// and bars players, waitlist holds a pending application) — nothing creates
// pending or waitlisted rows yet (registerSelf admits directly until the
// admission-mode work lands), but the transitions out of every state exist
// and are spec-covered. The remaining participation state, "disqualified",
// deliberately has no writer until the judge-operations DQ action.
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

type RosterTransitionArgs = {
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
}

// Restores a cancelled entry to a confirmed, active seat. Capacity applies:
// the cancellation released the seat, so retaking it competes with every
// registration since.
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
    event: { type: "player_reinstated", player: auditPlayerRef(registration) },
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
  if (
    registrationApproveEffect(tournament.lifecycle, registration) !== "confirm"
  ) {
    throw new Error("Registration cannot be approved in its current state");
  }
  requireCapacityAvailable(tournament);
  const now = Date.now();
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
      previousEntryStatus: registration.entryStatus,
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
  if (rejectEffect === null) {
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
      previousEntryStatus: registration.entryStatus,
    },
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
}
