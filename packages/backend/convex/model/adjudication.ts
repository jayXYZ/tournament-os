import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { userError } from "./errors";
import { applyAwardedMatchLoss } from "./matchResults";
import { dropPlayer } from "./roster";

// The adjudication module: match outcomes an organizer awards rather than
// enters as a played scoreline (see CONTEXT.md "Forfeit" and "No-Show").
// Each verb owns its eligibility and the order of its writes; the result
// itself goes through model/matchResults.ts like every other result, and a
// no-show's drop through model/roster.ts like every other drop. The endpoint
// resolves the match and authorizes the organizer (requireAdjudicableMatch
// in tournaments/rounds.ts), so everything here runs on an active round.
//
// These are entered results: they block a rewind and a pairing break exactly
// as a played result does (roundHasRecordedResult), and a later organizer
// result replaces them like any other.

export type AdjudicableMatch = {
  tournament: Doc<"tournaments">;
  match: Doc<"tournamentMatches">;
  phase: Doc<"tournamentPhases">;
  round: Doc<"tournamentRounds">;
  players: Doc<"tournamentMatchPlayers">[];
  user: Doc<"users">;
};

// The named players' registrations, each verified to hold a seat in the
// match. A bye (one seat) and a foreign registration are both things a
// well-behaved client never sends, so they stay plain errors.
async function requireMatchRegistrations(
  ctx: MutationCtx,
  players: Doc<"tournamentMatchPlayers">[],
  registrationIds: Id<"tournamentRegistrations">[],
  mismatch: string,
) {
  if (players.length !== 2) {
    throw new Error("Match result requires exactly two players");
  }
  const registrations: Doc<"tournamentRegistrations">[] = [];
  for (const registrationId of registrationIds) {
    if (!players.some((player) => player.playerId === registrationId)) {
      throw new Error(mismatch);
    }
    const registration = await ctx.db.get(registrationId);
    if (!registration) {
      throw new Error("Registration not found");
    }
    registrations.push(registration);
  }
  return registrations;
}

// A Forfeit: the match is awarded against one player without play, and the
// opponent wins it. Nobody is dropped — a forfeit is a match consequence
// only.
export async function recordForfeit(
  ctx: MutationCtx,
  target: AdjudicableMatch,
  args: {
    forfeitedRegistrationId: Id<"tournamentRegistrations">;
    note?: string;
  },
) {
  const losers = await requireMatchRegistrations(
    ctx,
    target.players,
    [args.forfeitedRegistrationId],
    "Forfeited player must be part of the match",
  );
  await applyAwardedMatchLoss(ctx, {
    match: target.match,
    phase: target.phase,
    round: target.round,
    players: target.players,
    kind: "forfeit",
    losers,
    actor: target.user,
    note: args.note,
  });
}

// A No-Show: a Forfeit against an absent player, which by default also
// drops them (MTR 2.10 drops a player who does not show up for their match
// unless they report in; `keepInTournament` is that report). Both players
// absent is a double match loss. In a bracket the double loss advances
// nobody — the seat empties and the walkover machinery carries on from
// there (model/singleElimination.ts).
export async function recordNoShow(
  ctx: MutationCtx,
  target: AdjudicableMatch,
  args: {
    absentRegistrationIds: Id<"tournamentRegistrations">[];
    keepInTournament: boolean;
    note?: string;
  },
) {
  const absentIds = [...new Set(args.absentRegistrationIds)];
  if (absentIds.length === 0 || absentIds.length > 2) {
    throw userError("A no-show names one or both players of the match");
  }
  const absent = await requireMatchRegistrations(
    ctx,
    target.players,
    absentIds,
    "Absent players must be part of the match",
  );
  // The result lands first, so the drop below finds the match already
  // decided and concedes nothing, and the log reads causally: the no-show,
  // then the drop it caused.
  await applyAwardedMatchLoss(ctx, {
    match: target.match,
    phase: target.phase,
    round: target.round,
    players: target.players,
    kind: "no_show",
    losers: absent,
    actor: target.user,
    note: args.note,
  });
  if (args.keepInTournament) {
    return;
  }
  for (const registration of absent) {
    // Only a player still in the event has anything to drop: one already
    // dropped (the no-show replacing their drop's concession) or eliminated
    // keeps that state.
    if (registration.participationStatus !== "active") {
      continue;
    }
    await dropPlayer(ctx, {
      tournament: target.tournament,
      registration,
      actor: target.user,
      actorRole: "organizer",
    });
  }
}
