import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  BYE_MATCH_POINTS,
  compareStandingRows,
  hasCumulativeTotals,
} from "./standings";

export type RankedRegistration = {
  registration: Doc<"tournamentRegistrations">;
  matchPoints: number;
  opponentMatchWinPct: number;
  gameWinPct: number;
  opponentGameWinPct: number;
  createdAt: number;
  opponentIds: Set<Id<"tournamentRegistrations">>;
  hasHadBye: boolean;
};

export type Pairing = {
  playerOne: Doc<"tournamentRegistrations">;
  playerTwo?: Doc<"tournamentRegistrations">;
  isBye: boolean;
};

export async function createRoundWithPairings(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundNumber: number;
    registrations: Doc<"tournamentRegistrations">[];
    previousRoundId?: Id<"tournamentRounds">;
  },
) {
  const now = Date.now();
  const roundId = await ctx.db.insert("tournamentRounds", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    roundNumber: args.roundNumber,
    roundName: `Round ${args.roundNumber}`,
    roundStatus: "in_progress",
    updatedAt: now,
  });
  const ranked = await rankedRegistrationsForPairing(ctx, {
    registrations: args.registrations,
    previousRoundId: args.previousRoundId,
  });
  const pairings = buildSwissPairings(ranked);

  let tableNumber = 1;
  for (const pairing of pairings) {
    const matchId = await ctx.db.insert("tournamentMatches", {
      tournamentId: args.tournament._id,
      tournamentPhaseId: args.phase._id,
      tournamentRoundId: roundId,
      tableNumber: pairing.isBye ? undefined : tableNumber,
      matchStatus: pairing.isBye ? "completed" : "upcoming",
      updatedAt: now,
    });

    if (pairing.isBye) {
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerOne._id,
        matchPointsEarned: BYE_MATCH_POINTS,
        gameWins: 2,
        gameLosses: 0,
        isBye: true,
        updatedAt: now,
      });
    } else if (pairing.playerTwo) {
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerOne._id,
        opponentPlayerId: pairing.playerTwo._id,
        isBye: false,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerTwo._id,
        opponentPlayerId: pairing.playerOne._id,
        isBye: false,
        updatedAt: now,
      });
    }

    if (!pairing.isBye) {
      tableNumber += 1;
    }
  }

  return roundId;
}

export async function rankedRegistrationsForPairing(
  ctx: QueryCtx,
  args: {
    registrations: Doc<"tournamentRegistrations">[];
    previousRoundId?: Id<"tournamentRounds">;
  },
): Promise<RankedRegistration[]> {
  if (!args.previousRoundId) {
    return [...args.registrations]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((registration) => ({
        registration,
        matchPoints: 0,
        opponentMatchWinPct: 0,
        gameWinPct: 0,
        opponentGameWinPct: 0,
        createdAt: registration.createdAt,
        opponentIds: new Set<Id<"tournamentRegistrations">>(),
        hasHadBye: false,
      }));
  }

  const previousRoundId = args.previousRoundId;
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", previousRoundId),
    )
    .take(512);
  const standingByPlayer = new Map(
    standings.map((standing) => [standing.playerId, standing]),
  );

  const ranked: RankedRegistration[] = [];
  for (const registration of args.registrations) {
    const standing = standingByPlayer.get(registration._id);
    const history =
      standing && hasCumulativeTotals(standing)
        ? {
            opponentIds: new Set(standing.opponentIds ?? []),
            hasHadBye: standing.hasHadBye ?? false,
          }
        : await playerPairingHistory(ctx, registration._id);

    ranked.push({
      registration,
      matchPoints: standing?.matchPoints ?? 0,
      opponentMatchWinPct: standing?.opponentMatchWinPct ?? 0,
      gameWinPct: standing?.gameWinPct ?? 0,
      opponentGameWinPct: standing?.opponentGameWinPct ?? 0,
      createdAt: registration.createdAt,
      ...history,
    });
  }

  return ranked.sort(compareStandingRows);
}

export function buildSwissPairings(
  rankedRegistrations: RankedRegistration[],
): Pairing[] {
  const remaining = [...rankedRegistrations].sort(compareStandingRows);
  const pairings: Pairing[] = [];

  if (remaining.length % 2 === 1) {
    let byeIndex = remaining.length - 1;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (!remaining[index].hasHadBye) {
        byeIndex = index;
        break;
      }
    }
    const bye = remaining.splice(byeIndex, 1)[0];
    pairings.push({ playerOne: bye.registration, isBye: true });
  }

  while (remaining.length > 0) {
    const playerOne = remaining.shift();
    if (!playerOne) {
      break;
    }
    let opponentIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (!playerOne.opponentIds.has(candidate.registration._id)) {
        opponentIndex = index;
        break;
      }
    }
    const playerTwo = remaining.splice(opponentIndex, 1)[0];
    if (!playerTwo) {
      pairings.push({ playerOne: playerOne.registration, isBye: true });
    } else {
      pairings.push({
        playerOne: playerOne.registration,
        playerTwo: playerTwo.registration,
        isBye: false,
      });
    }
  }

  return pairings;
}

// Fallback for registrations whose previous-round standings row predates the
// denormalized history fields (or who have no row, e.g. after reinstatement).
async function playerPairingHistory(
  ctx: QueryCtx,
  playerId: Id<"tournamentRegistrations">,
) {
  const rows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(64);

  const opponentIds = new Set<Id<"tournamentRegistrations">>();
  for (const row of rows) {
    if (row.opponentPlayerId) {
      opponentIds.add(row.opponentPlayerId);
    }
  }

  return {
    opponentIds,
    hasHadBye: rows.some((row) => row.isBye),
  };
}
