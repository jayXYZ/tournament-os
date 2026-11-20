import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { latestCompletedRound } from "./phases";
import { loadPhaseBoards } from "./progression";
import {
  MAX_TOURNAMENT_PLAYERS,
  eliminatedRegistrations,
} from "./registrations";
import {
  isPairingsVisibleToPlayers,
  roundMatchesWithPlayers,
  tournamentByPublicCode,
  tournamentViewAccess,
} from "./tournaments";

// Public Results (CONTEXT.md): the standings and the released rounds' matches
// that the event page shows to every viewer who may open that page. The
// reads here return projections built field by field, never documents: the
// tournament's pairing seed, registrations' tiebreakRandom, standings rows'
// opponent lists, and anything organizer-only stay behind the projection.
// Names are the player-safe stamps (model/nameStamps.ts) the rows already
// carry — the copy the player standings and the organizer pairings render —
// so a list costs no per-row identity join. A stamp is as old as its row:
// standings carry the current name, a round's matches the name as it stood
// when the round was paired.

// A stamp is whatever the account holds or the organizer typed, and the
// enrollment forms accept an email address typed into the name field. That
// is a contact detail the public page must not print, so a stamp shaped like
// an address is withheld and the row reads as an unnamed player.
const EMAIL_SHAPED = /\S+@\S+\.\S+/;

export function publicPlayerName(stamp: string | undefined): string | null {
  return stamp === undefined || EMAIL_SHAPED.test(stamp) ? null : stamp;
}

// The tournament behind a public code, when the caller may open its event
// page: getPublicTournament's rule (tournamentViewAccess), so the results can
// never be visible to a viewer the page itself refuses. Null for an unknown
// code and for a refused viewer alike.
export async function tournamentForPublicView(
  ctx: QueryCtx,
  publicCode: string,
  inviteCode: string | undefined,
): Promise<Doc<"tournaments"> | null> {
  const tournament = await tournamentByPublicCode(ctx, publicCode);
  if (!tournament) {
    return null;
  }
  const access = await tournamentViewAccess(ctx, tournament, inviteCode);
  return access.allowed ? tournament : null;
}

// Play has begun at some point: before that there are no rounds or standings
// to show, and a cancelled event that never started has none either. A
// completed or cancelled event keeps the record it reached.
function playHasStarted(tournament: Doc<"tournaments">) {
  return (
    tournament.lifecycle === "in_progress" ||
    tournament.lifecycle === "completed" ||
    tournament.lifecycle === "cancelled"
  );
}

// One standings row as anyone may see it. Shared with the player standings
// (getLatestStandings), which adds only its own "is this me" marker, so the
// public and player tables carry the same columns and tiebreak values.
export function standingRowProjection(standing: Doc<"roundStandings">) {
  return {
    rank: standing.rank,
    name: standing.playerName ?? null,
    matchPoints: standing.matchPoints,
    matchWins: standing.matchWins,
    matchLosses: standing.matchLosses,
    matchDraws: standing.matchDraws,
    opponentMatchWinPct: standing.opponentMatchWinPct,
    gameWinPct: standing.gameWinPct,
    opponentGameWinPct: standing.opponentGameWinPct,
    playoffStatus: standing.playoffStatus,
    eliminatedInRoundNumber: standing.eliminatedInRoundNumber ?? null,
    registrationStatus: standing.participationStatus ?? "active",
  };
}

// The standings of the tournament's latest completed round, in rank order —
// the round both the player standings and final placements treat as current
// (latestCompletedRound). Null before any round completes.
export async function latestStandings(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const round = await latestCompletedRound(ctx, tournamentId);
  if (!round) {
    return null;
  }
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", round._id),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
  return { round, standings };
}

// The players a cut eliminated for a next phase whose first round is paired
// but still held for the organizer. Pairing that round applies the cut
// (eliminateNonQualifiers), which flips the non-qualifiers' status on the
// very standings rows the public reads, so their status would announce the
// held round and who made it. Empty when no later phase holds a round.
//
// The cut stamps the round it was drawn from, which is the latest completed
// round, so one range over the eliminated roster finds exactly its batch:
// players cut at an earlier boundary carry an earlier round's stamp and stay
// eliminated in public, as they already were.
async function playersCutForHeldRound(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  latestRound: Doc<"tournamentRounds">,
): Promise<ReadonlySet<Id<"tournamentRegistrations">>> {
  const boards = await loadPhaseBoards(ctx, tournament._id);
  const laterPhaseHoldsRound = boards.some(
    ({ phase, rounds }) =>
      phase._id !== latestRound.tournamentPhaseId &&
      rounds.some(
        (round) =>
          round.roundNumber > latestRound.roundNumber &&
          !isPairingsVisibleToPlayers(round),
      ),
  );
  if (!laterPhaseHoldsRound) {
    return new Set();
  }
  const eliminated = await eliminatedRegistrations(ctx, tournament._id);
  return new Set(
    eliminated
      .filter(
        (registration) => registration.eliminatedByRoundId === latestRound._id,
      )
      .map((registration) => registration._id),
  );
}

// The public standings: the latest completed round's rows, projected. A
// completed round is always released (completeRound publishes a held round as
// part of the record), and the check below keeps that true here even if the
// lifecycle ever changes, so standings never reveal results from a round the
// players have not been shown. A held round's cut is kept back the same way:
// until its pairings are released, the players it cut still read as active.
export async function publicStandings(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  if (!playHasStarted(tournament)) {
    return null;
  }
  const latest = await latestStandings(ctx, tournament._id);
  if (!latest || !isPairingsVisibleToPlayers(latest.round)) {
    return null;
  }
  const heldCut = await playersCutForHeldRound(ctx, tournament, latest.round);
  return {
    roundNumber: latest.round.roundNumber,
    roundName: latest.round.roundName,
    rows: latest.standings.map((standing) => {
      const row = standingRowProjection(standing);
      return {
        ...row,
        name: publicPlayerName(standing.playerName),
        // A bracket loss in this round is already public (playoffStatus
        // says so), so only the cut's own eliminations are held back.
        registrationStatus:
          heldCut.has(standing.playerId) &&
          standing.playoffStatus !== "eliminated"
            ? ("active" as const)
            : row.registrationStatus,
      };
    }),
  };
}

// Every round whose pairings are released to players, grouped by phase in
// play order. A round still held for the organizer is left out entirely —
// not listed as pending — so the public cannot tell it exists. Phases with no
// released round are left out too.
async function releasedRoundsByPhase(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  if (!playHasStarted(tournament)) {
    return [];
  }
  const boards = await loadPhaseBoards(ctx, tournament._id);
  return boards
    .map(({ phase, rounds }) => ({
      phase,
      rounds: rounds.filter(isPairingsVisibleToPlayers),
    }))
    .filter(({ rounds }) => rounds.length > 0);
}

// Pairings and results for one released round, plus the round index the page
// navigates with. `requestedRoundId` picks the round; anything that is not a
// released round of this tournament (unknown, held, another event's) falls
// back to the default exactly as if no round had been asked for, so probing
// ids reveals nothing. The default is the latest released round: the current
// round once its pairings are out, otherwise the one before it.
export async function publicRoundMatches(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  requestedRoundId: Id<"tournamentRounds"> | undefined,
) {
  const phases = await releasedRoundsByPhase(ctx, tournament);
  const released = phases.flatMap(({ rounds }) => rounds);
  const selected =
    released.find((round) => round._id === requestedRoundId) ??
    released.at(-1) ??
    null;

  const index = phases.map(({ phase, rounds }) => ({
    phaseOrder: phase.phaseOrder,
    phaseName: phase.phaseName ?? `Phase ${phase.phaseOrder}`,
    phaseType: phase.phaseType,
    rounds: rounds.map((round) => ({
      roundId: round._id,
      roundNumber: round.roundNumber,
      roundName: round.roundName,
      roundStatus: round.roundStatus,
    })),
  }));

  if (!selected) {
    return { phases: index, round: null, matches: [] };
  }

  const selectedPhase = phases.find(
    ({ phase }) => phase._id === selected.tournamentPhaseId,
  )?.phase;
  const matches = await roundMatchesWithPlayers(ctx, selected._id);
  return {
    phases: index,
    round: {
      roundId: selected._id,
      roundNumber: selected.roundNumber,
      roundName: selected.roundName,
      roundStatus: selected.roundStatus,
      phaseOrder: selectedPhase?.phaseOrder ?? null,
      phaseType: selectedPhase?.phaseType ?? null,
    },
    matches: matches.map(({ match, players }) => ({
      matchId: match._id,
      tableNumber: match.tableNumber ?? null,
      matchStatus: match.matchStatus,
      resultKind: match.currentResultKind ?? null,
      // A player's own report counts immediately (CONTEXT.md "Reported
      // Result"); the marker says nobody at the organizer table entered it.
      // Only whether one exists crosses the seam, not who reported it.
      playerReported: match.reportedByRegistrationId !== undefined,
      players: players.map((player) => ({
        name: publicPlayerName(player.playerName),
        isBye: player.isBye,
        gameWins: player.gameWins ?? null,
        gameLosses: player.gameLosses ?? null,
        gameDraws: player.gameDraws ?? null,
      })),
    })),
  };
}
