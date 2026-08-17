import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuditActorRole } from "./auditLog";
import { auditPlayerRef, logAuditEvent } from "./auditLog";
import { concedeUnfinishedMatchOnDrop } from "./matchResults";
import { setRegistrationState } from "./participation";
import {
  adjustConfirmedRegistrationCount,
  registrationDropEffect,
  registrationReinstateEffect,
  requireCapacityAvailable,
} from "./registrations";

// The roster workflow module: the four named verbs that change who is in the
// event. Entry Status and Participation Status are independent (see
// CONTEXT.md), so the verbs come in two pairs — cancelEntry/restoreEntry
// move the admission state (and the seat counter with it), while
// dropPlayer/reinstatePlayer move a confirmed player's competitive state.
// Each verb owns its eligibility per actor, the registration write (through
// setRegistrationState, which keeps the standings copy in step — see
// model/participation.ts), the audit event, and — for a drop — the
// Concession, in one enforced order. Endpoints stay thin adapters: they
// resolve auth, rate limits, and endpoint-specific error messages, then pass
// the actor. The organizer roster actions route here on the same
// registrationDropEffect / registrationReinstateEffect projections the
// client renders its buttons from, so what an action offers and what its
// verb does can never diverge.

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

// Releases a confirmed seat before play: the entry is cancelled and the seat
// count drops, and — because a cancelled row is the standing invitation back
// into a private event (see registerSelf) — the player can later re-register
// into it. The rule is the same for both actors, and dropped rows are
// accepted too: a drop preserved by a round-one rewind still holds the
// player's seat, and cancelling releases it.
export async function cancelEntry(
  ctx: MutationCtx,
  { tournament, registration, actor, actorRole }: RosterTransitionArgs,
) {
  if (tournament.lifecycle !== "registration") {
    throw new Error("Tournament is not open for registration");
  }
  if (registrationDropEffect(tournament.lifecycle, registration) !== "cancel") {
    throw new Error("Active registration not found");
  }
  const now = Date.now();
  await setRegistrationState(ctx, registration._id, {
    entryStatus: "cancelled",
    updatedAt: now,
  });
  await adjustConfirmedRegistrationCount(ctx, tournament, -1, now);
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
