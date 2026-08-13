import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { type CutoffPartition, cutoffPartition } from "./cutoffs";
import type { Pairing } from "./pairing";
import { eliminatePlayers } from "./participation";
import { SINGLE_ELIMINATION_PLAYERS, previousTournamentRound } from "./phases";
import type { RoundMatchWithPlayers } from "./standings";
import { roundMatchesWithPlayers } from "./tournaments";

// The top-8 playoff entry is a fixed top-X cut over the phase-final round's
// standings; the shared partition also names the dropped players who keep an
// elimination record (see eliminateNonQualifiers in model/participation.ts).
export async function topEightCutFromStandings(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  roundId: Id<"tournamentRounds">,
): Promise<CutoffPartition> {
  const cut = await cutoffPartition(ctx, tournamentId, roundId, {
    kind: "top_X_players",
    playerCount: SINGLE_ELIMINATION_PLAYERS,
  });
  if (cut.qualifiers.length !== SINGLE_ELIMINATION_PLAYERS) {
    throw new Error("A top-8 playoff requires at least eight active players");
  }
  return cut;
}

// The game-winner of a bracket match: a bye's lone player, otherwise whoever
// took more games. Participation status never factors in — a departed winner
// still won the match.
function matchGameWinner({
  players,
}: RoundMatchWithPlayers): Doc<"tournamentMatchPlayers"> {
  if (players.length === 1 && players[0].isBye) {
    return players[0];
  }
  if (players.length !== 2) {
    throw new Error("Single-elimination matches require exactly two players");
  }
  const [first, second] = players;
  const firstWins = first.gameWins ?? 0;
  const secondWins = second.gameWins ?? 0;
  if (firstWins === secondWins) {
    throw new Error("Single-elimination matches must have a winner");
  }
  return firstWins > secondWins ? first : second;
}

// The completed round's seat winners in table order: the registrations whose
// seats the next bracket round is built from. Departed winners are included
// deliberately — bracket structure is sacred, so a withdrawal never revives
// the defeated opponent; the seat advances and the walkover materializes when
// the next round is paired (see ADR 0001 and CONTEXT.md "Walkover").
export async function singleEliminationSeatWinners(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
): Promise<Doc<"tournamentRegistrations">[]> {
  const matchesWithPlayers = await roundMatchesWithPlayers(ctx, roundId);
  return await mapAsyncInBatches(
    matchesWithPlayers.map((match) => matchGameWinner(match).playerId),
    DATABASE_IO_BATCH_SIZE,
    async (playerId) => {
      const registration = await ctx.db.get(playerId);
      if (!registration) {
        throw new Error("Seat winner's registration not found");
      }
      return registration;
    },
  );
}

// Pairs a bracket round from the previous round's seat winners, materializing
// walkovers (CONTEXT.md "Walkover"): adjacent seats meet; a seat whose holder
// has left the tournament concedes the match uncontested, so the scheduled
// opponent receives it as a Bye. A pair with no live player advances no seat
// at all — the walkover chains, and the seat's scheduled opponent next round
// is walked over in turn. A defeated player is never revived into a slot. An
// odd trailing seat is one whose scheduled opponent's seat already emptied.
export function planSingleEliminationPairings(
  seatWinners: Doc<"tournamentRegistrations">[],
): Pairing[] {
  const pairings: Pairing[] = [];
  for (let index = 0; index < seatWinners.length; index += 2) {
    const one = seatWinners[index];
    const two = seatWinners.at(index + 1);
    const oneLive = one.participationStatus === "active";
    const twoLive = two?.participationStatus === "active";
    if (oneLive && two && twoLive) {
      pairings.push({ playerOne: one, playerTwo: two, isBye: false });
    } else if (oneLive) {
      pairings.push({ playerOne: one, isBye: true });
    } else if (two && twoLive) {
      pairings.push({ playerOne: two, isBye: true });
    }
  }
  return pairings;
}

export async function eliminateSingleEliminationLosers(
  ctx: MutationCtx,
  round: Doc<"tournamentRounds">,
  matchesWithPlayers: RoundMatchWithPlayers[],
) {
  // Two groups leave the bracket when a round completes: this round's game
  // losers, and the previous round's seat winners the pairing walked over —
  // departed players whose scheduled match was awarded to the opponent (or
  // skipped entirely). The walkover round is the seat they reached, so it is
  // the round their elimination records.
  const participantIds = new Set<Id<"tournamentRegistrations">>();
  const departingIds = new Set<Id<"tournamentRegistrations">>();
  for (const matchWithPlayers of matchesWithPlayers) {
    const winner = matchGameWinner(matchWithPlayers);
    for (const player of matchWithPlayers.players) {
      participantIds.add(player.playerId);
      if (player.playerId !== winner.playerId) {
        departingIds.add(player.playerId);
      }
    }
  }
  const previousRound = await previousTournamentRound(ctx, round);
  if (previousRound?.tournamentPhaseId === round.tournamentPhaseId) {
    for (const seatWinner of await singleEliminationSeatWinners(
      ctx,
      previousRound._id,
    )) {
      if (!participantIds.has(seatWinner._id)) {
        departingIds.add(seatWinner._id);
      }
    }
  }

  const departing = await mapAsyncInBatches(
    [...departingIds],
    DATABASE_IO_BATCH_SIZE,
    async (id) => await ctx.db.get(id),
  );
  const eliminated: Doc<"tournamentRegistrations">[] = [];
  const droppedDepartures: Doc<"tournamentRegistrations">[] = [];
  for (const registration of departing) {
    if (registration?.participationStatus === "active") {
      // Usually a game loser; also a walked-over player reinstated after the
      // pairing passed their seat by — the walkover stands, so reinstatement
      // returns them to the standings, not the bracket.
      eliminated.push(registration);
    } else if (registration?.participationStatus === "dropped") {
      // The withdrawal stands; the stamp records where they left the bracket,
      // so a rewind that cleared it re-records it when the round is
      // re-completed and a reinstate restores the elimination.
      droppedDepartures.push(registration);
    }
  }
  // completeRound calls this right after rewriting the round's standings, so
  // round._id is the tournament's latest completed round — the contract
  // eliminatePlayers needs to land the status repair on that round's rows.
  await eliminatePlayers(ctx, {
    active: eliminated,
    dropped: droppedDepartures,
    byRoundId: round._id,
  });
}

// Named from the seat count the round is built from, so a bracket thinned by
// chained walkovers keeps its structural name: a lone remaining seat still
// plays (and can win) the Finals by walkover.
export function singleEliminationRoundName(seatCount: number) {
  if (seatCount === 4) {
    return "Semifinals";
  }
  if (seatCount === 2 || seatCount === 1) {
    return "Finals";
  }
  throw new Error("Unexpected single-elimination bracket size");
}
