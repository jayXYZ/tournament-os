import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAuditEvent } from "./auditLog";
import {
  deleteResultRevisionsForMatch,
  materializeAwardedByeMatch,
} from "./matchResults";
import { insertPairedMatch } from "./pairing";
import { SWISS_FORMAT, requirePhase } from "./phases";
import { activeRegistrations } from "./registrations";
import {
  isPairingsVisibleToPlayers,
  matchPlayers,
  playerMatchInRound,
  requireRound,
  roundMatches,
  roundMatchesWithPlayers,
} from "./tournaments";

// Organizer pairing edits: breaking a generated pairing and re-pairing the
// freed players by hand (against each other or as a Bye). Only possible in
// the window where pairings are still organizer-only — once a round's
// pairings are published to players they are the round's record, and the
// only way back is a Rewind (CONTEXT.md "Rewind"). Bracket rounds are
// excluded entirely: their pairings are structural (seeds and seat winners,
// CONTEXT.md "Bracket"), so editing one would corrupt the advancement plan.

export const PAIRINGS_LOCKED_AFTER_PUBLISH =
  "Pairings can no longer be edited after they are published to players";
const PAIRINGS_EDITABLE_ONLY_IN_ACTIVE_ROUND =
  "Pairings can only be edited in the current active round";
const BRACKET_PAIRINGS_NOT_EDITABLE =
  "Bracket pairings are set by seeding and cannot be edited";
const MATCH_HAS_RECORDED_RESULT =
  "A pairing with a recorded result cannot be broken";
const PLAYER_ALREADY_PAIRED = "Player is already paired in this round";
const PLAYER_NOT_ACTIVE = "Player is not active in this tournament";

// The one statement of when a round's pairings are organizer-editable; the
// mutations enforce it and the organizer pairings surface mirrors it. The
// published check is the feature's defining gate; the current-round and
// in-progress checks are defensive (an unpublished round is always the
// phase's current in-progress round), and the Swiss check keeps bracket
// structure out of reach.
export async function requireEditablePairings(
  ctx: QueryCtx,
  round: Doc<"tournamentRounds">,
) {
  const phase = await requirePhase(ctx, round.tournamentPhaseId);
  if (isPairingsVisibleToPlayers(round)) {
    throw new Error(PAIRINGS_LOCKED_AFTER_PUBLISH);
  }
  if (
    round.roundStatus !== "in_progress" ||
    phase.phaseCurrentRound !== round._id
  ) {
    throw new Error(PAIRINGS_EDITABLE_ONLY_IN_ACTIVE_ROUND);
  }
  if (phase.phaseType !== SWISS_FORMAT) {
    throw new Error(BRACKET_PAIRINGS_NOT_EDITABLE);
  }
  return phase;
}

// Deletes one pairing — match, pairing rows, and result revisions — freeing
// its players for manual re-pairing. Automatic results are deleted with it
// (same rule as Rewind, model/tournaments.ts roundHasRecordedResult): a
// Bye's award exists only because the pairing did, and a Concession's drop
// survives the break. An entered result refuses the break instead — nothing
// anyone reported is ever destroyed by a pairing edit.
export async function breakPairing(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    user: Doc<"users">;
    match: Doc<"tournamentMatches">;
  },
): Promise<Id<"tournamentRounds">> {
  const { tournament, user, match } = args;
  const round = await requireRound(ctx, match.tournamentRoundId);
  await requireEditablePairings(ctx, round);
  if (
    match.matchStatus !== "upcoming" &&
    match.currentResultKind !== "bye" &&
    match.currentResultKind !== "concession"
  ) {
    throw new Error(MATCH_HAS_RECORDED_RESULT);
  }

  const players = await matchPlayers(ctx, match._id);
  for (const player of players) {
    await ctx.db.delete(player._id);
  }
  await deleteResultRevisionsForMatch(ctx, match._id);
  await ctx.db.delete(match._id);

  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "pairing_broken",
      roundId: round._id,
      roundNumber: round.roundNumber,
      tableNumber: match.tableNumber ?? null,
      players: players.map((player) => ({
        registrationId: player.playerId,
        playerName: player.playerName ?? null,
      })),
      wasBye: players.some((player) => player.isBye),
    },
  });
  return round._id;
}

// Pairs two currently unpaired active players against each other at the
// round's next free table. Rematch avoidance deliberately does not apply:
// the organizer is overriding the pairing engine, and the pairing they chose
// is the pairing they get.
export async function pairPlayersManually(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    user: Doc<"users">;
    round: Doc<"tournamentRounds">;
    playerOneRegistrationId: Id<"tournamentRegistrations">;
    playerTwoRegistrationId: Id<"tournamentRegistrations">;
  },
): Promise<Id<"tournamentMatches">> {
  const { tournament, user, round } = args;
  if (args.playerOneRegistrationId === args.playerTwoRegistrationId) {
    throw new Error("A player cannot be paired against themself");
  }
  const phase = await requireEditablePairings(ctx, round);
  const playerOne = await requireUnpairedActivePlayer(
    ctx,
    tournament,
    round,
    args.playerOneRegistrationId,
  );
  const playerTwo = await requireUnpairedActivePlayer(
    ctx,
    tournament,
    round,
    args.playerTwoRegistrationId,
  );

  const tableNumber = await nextFreeTableNumber(ctx, round._id);
  const matchId = await insertPairedMatch(ctx, {
    tournament,
    phase,
    roundId: round._id,
    playerOne,
    playerTwo,
    tableNumber,
    now: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "pairing_created",
      roundId: round._id,
      roundNumber: round.roundNumber,
      tableNumber,
      players: [
        {
          registrationId: playerOne._id,
          playerName: playerOne.playerName ?? null,
        },
        {
          registrationId: playerTwo._id,
          playerName: playerTwo.playerName ?? null,
        },
      ],
      isBye: false,
    },
  });
  return matchId;
}

// Awards a currently unpaired active player the round's Bye. The automatic
// assignment rule (lowest-ranked player without one, CONTEXT.md "Bye") does
// not constrain the organizer: a manual bye goes to whoever they choose,
// even a player who already had one.
export async function assignByeManually(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    user: Doc<"users">;
    round: Doc<"tournamentRounds">;
    registrationId: Id<"tournamentRegistrations">;
  },
): Promise<Id<"tournamentMatches">> {
  const { tournament, user, round } = args;
  const phase = await requireEditablePairings(ctx, round);
  const registration = await requireUnpairedActivePlayer(
    ctx,
    tournament,
    round,
    args.registrationId,
  );

  const matchId = await materializeAwardedByeMatch(ctx, {
    tournament,
    phase,
    roundId: round._id,
    registration,
    now: Date.now(),
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: {
      type: "pairing_created",
      roundId: round._id,
      roundNumber: round.roundNumber,
      tableNumber: null,
      players: [
        {
          registrationId: registration._id,
          playerName: registration.playerName ?? null,
        },
      ],
      isBye: true,
    },
  });
  return matchId;
}

// The active players holding no pairing in the round — the pool manual
// pairing draws from, and the set that must be empty before pairings can be
// published (model/progression.ts). Derived from the round's pairing rows so
// it can never disagree with what the pairings list shows.
export async function unpairedActiveRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  roundId: Id<"tournamentRounds">,
): Promise<Doc<"tournamentRegistrations">[]> {
  const matchesWithPlayers = await roundMatchesWithPlayers(ctx, roundId);
  const registrations = await activeRegistrations(ctx, tournamentId);
  return filterUnpaired(registrations, matchesWithPlayers);
}

// The filter behind unpairedActiveRegistrations, split out so
// analyzeProgression can reuse the rows it already loaded.
export function filterUnpaired(
  registrations: Doc<"tournamentRegistrations">[],
  matchesWithPlayers: readonly {
    players: readonly Pick<Doc<"tournamentMatchPlayers">, "playerId">[];
  }[],
): Doc<"tournamentRegistrations">[] {
  const pairedIds = new Set<Id<"tournamentRegistrations">>();
  for (const { players } of matchesWithPlayers) {
    for (const player of players) {
      pairedIds.add(player.playerId);
    }
  }
  return registrations.filter(
    (registration) => !pairedIds.has(registration._id),
  );
}

async function requireUnpairedActivePlayer(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds">,
  registrationId: Id<"tournamentRegistrations">,
): Promise<Doc<"tournamentRegistrations">> {
  const registration = await ctx.db.get(registrationId);
  if (
    !registration ||
    registration.tournamentId !== tournament._id ||
    registration.entryStatus !== "confirmed" ||
    registration.participationStatus !== "active"
  ) {
    throw new Error(PLAYER_NOT_ACTIVE);
  }
  if (await playerMatchInRound(ctx, registration._id, round._id)) {
    throw new Error(PLAYER_ALREADY_PAIRED);
  }
  return registration;
}

// One past the round's highest assigned table. Broken pairings leave their
// table numbers unreused, so a manual pairing can never collide with a table
// players may already be walking toward.
async function nextFreeTableNumber(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
): Promise<number> {
  const matches = await roundMatches(ctx, roundId);
  let highest = 0;
  for (const match of matches) {
    if (match.tableNumber !== undefined && match.tableNumber > highest) {
      highest = match.tableNumber;
    }
  }
  return highest + 1;
}
