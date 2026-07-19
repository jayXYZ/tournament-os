import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireResolvedPhaseTotalRounds, roundNumberInPhase } from "./phases";
import { createSeededRandom, pairingSeed, seededShuffle } from "./random";
import { MAX_TOURNAMENT_PLAYERS } from "./registrations";
import {
  BYE_MATCH_POINTS,
  compareStandingRows,
  hasCumulativeTotals,
} from "./standings";

export type PairingOptions = {
  // Stored tournament seed driving the within-bracket shuffle.
  seed: number;
  roundNumber: number;
  // True when this is the configured final round of the phase.
  finalRound: boolean;
  // When true, the final round power-pairs (orders brackets by tiebreakers)
  // instead of randomizing within each bracket.
  powerPairFinalRound: boolean;
};

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

const TOP_EIGHT_BRACKET_ORDER = [0, 7, 3, 4, 1, 6, 2, 5] as const;

// Seeds occupy a fixed bracket: 1v8, 4v5, 2v7, 3v6. Keeping matches in this
// table order makes later rounds a simple adjacent-winner pairing without a
// reseed, preserving the two halves of the bracket through the final.
export function buildTopEightSingleEliminationPairings(
  registrationsBySeed: Doc<"tournamentRegistrations">[],
): Pairing[] {
  if (registrationsBySeed.length !== 8) {
    throw new Error("Single elimination requires exactly eight seeded players");
  }
  const bracket = TOP_EIGHT_BRACKET_ORDER.map(
    (seedIndex) => registrationsBySeed[seedIndex],
  );
  return pairAdjacentRegistrations(bracket);
}

export function buildSingleEliminationAdvancementPairings(
  winnersInTableOrder: Doc<"tournamentRegistrations">[],
): Pairing[] {
  if (winnersInTableOrder.length < 2 || winnersInTableOrder.length % 2 !== 0) {
    throw new Error("Single-elimination advancement requires an even field");
  }
  return pairAdjacentRegistrations(winnersInTableOrder);
}

function pairAdjacentRegistrations(
  registrations: Doc<"tournamentRegistrations">[],
): Pairing[] {
  const pairings: Pairing[] = [];
  for (let index = 0; index < registrations.length; index += 2) {
    pairings.push({
      playerOne: registrations[index],
      playerTwo: registrations[index + 1],
      isBye: false,
    });
  }
  return pairings;
}

export async function createSingleEliminationRoundWithPairings(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundNumber: number;
    roundName: string;
    registrations: Doc<"tournamentRegistrations">[];
    seededFirstRound: boolean;
  },
) {
  const pairings = args.seededFirstRound
    ? buildTopEightSingleEliminationPairings(args.registrations)
    : buildSingleEliminationAdvancementPairings(args.registrations);
  const now = Date.now();
  const roundId = await ctx.db.insert("tournamentRounds", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    roundNumber: args.roundNumber,
    roundName: args.roundName,
    roundStatus: "in_progress",
    pairingsPublishedAt: args.tournament.autoPublishPairings ? now : undefined,
    updatedAt: now,
  });

  for (const [index, pairing] of pairings.entries()) {
    const matchId = await ctx.db.insert("tournamentMatches", {
      tournamentId: args.tournament._id,
      tournamentPhaseId: args.phase._id,
      tournamentRoundId: roundId,
      tableNumber: index + 1,
      matchStatus: "upcoming",
      updatedAt: now,
    });
    if (!pairing.playerTwo) {
      throw new Error("Single-elimination match is missing an opponent");
    }
    await ctx.db.insert("tournamentMatchPlayers", {
      tournamentMatchId: matchId,
      playerId: pairing.playerOne._id,
      playerName: pairing.playerOne.playerName,
      opponentPlayerId: pairing.playerTwo._id,
      isBye: false,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentMatchPlayers", {
      tournamentMatchId: matchId,
      playerId: pairing.playerTwo._id,
      playerName: pairing.playerTwo.playerName,
      opponentPlayerId: pairing.playerOne._id,
      isBye: false,
      updatedAt: now,
    });
  }
  return roundId;
}

export async function createRoundWithPairings(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    // The phase's phaseTotalRounds must already be resolved (non-null).
    phase: Doc<"tournamentPhases">;
    // Global across the tournament (Magic-style): a later phase continues
    // the numbering.
    roundNumber: number;
    registrations: Doc<"tournamentRegistrations">[];
    previousRoundId?: Id<"tournamentRounds">;
  },
) {
  // Whether this is the phase's configured final round (which optionally
  // power-pairs), derived here from the new round's position within the
  // phase so every caller gets the same answer. Computed before the insert
  // so the phase's first existing round is still the true first round.
  const phaseTotalRounds = requireResolvedPhaseTotalRounds(args.phase);
  const finalRound =
    (await roundNumberInPhase(ctx, {
      tournamentPhaseId: args.phase._id,
      roundNumber: args.roundNumber,
    })) >= phaseTotalRounds;

  const now = Date.now();
  const roundId = await ctx.db.insert("tournamentRounds", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    roundNumber: args.roundNumber,
    roundName: `Round ${args.roundNumber}`,
    roundStatus: "in_progress",
    pairingsPublishedAt: args.tournament.autoPublishPairings ? now : undefined,
    updatedAt: now,
  });
  const ranked = await rankedRegistrationsForPairing(ctx, {
    registrations: args.registrations,
    previousRoundId: args.previousRoundId,
  });
  const pairings = buildSwissPairings(ranked, {
    seed: args.tournament.seed ?? args.tournament.publicCode,
    roundNumber: args.roundNumber,
    finalRound,
    powerPairFinalRound: args.phase.powerPairFinalRound ?? true,
  });

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
        playerName: pairing.playerOne.playerName,
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
        playerName: pairing.playerOne.playerName,
        opponentPlayerId: pairing.playerTwo._id,
        isBye: false,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerTwo._id,
        playerName: pairing.playerTwo.playerName,
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
    .take(MAX_TOURNAMENT_PLAYERS);
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
  options: PairingOptions,
): Pairing[] {
  // Standings order is used for the bye choice (MTR ranks the bye by standings,
  // not randomly), then handed to orderForPairing for the within-bracket shuffle.
  const standingsSorted = [...rankedRegistrations].sort(compareStandingRows);
  const pairings: Pairing[] = [];

  if (standingsSorted.length % 2 === 1) {
    let byeIndex = standingsSorted.length - 1;
    for (let index = standingsSorted.length - 1; index >= 0; index -= 1) {
      if (!standingsSorted[index].hasHadBye) {
        byeIndex = index;
        break;
      }
    }
    const bye = standingsSorted.splice(byeIndex, 1)[0];
    pairings.push({ playerOne: bye.registration, isBye: true });
  }

  const ordered = orderForPairing(standingsSorted, options);
  for (const match of matchPairings(ordered)) {
    pairings.push({
      playerOne: match.playerOne.registration,
      playerTwo: match.playerTwo.registration,
      isBye: false,
    });
  }

  return pairings;
}

type RankedMatch = {
  playerOne: RankedRegistration;
  playerTwo: RankedRegistration;
};

// Groups players into match-point brackets (highest first). Regular rounds
// randomize within each bracket (seeded, so reproducible); the final round
// optionally power-pairs by ordering each bracket on tiebreakers. Concatenating
// brackets highest-first lets the matcher float leftover players down naturally.
function orderForPairing(
  players: RankedRegistration[],
  options: PairingOptions,
): RankedRegistration[] {
  const brackets = new Map<number, RankedRegistration[]>();
  for (const player of players) {
    const group = brackets.get(player.matchPoints) ?? [];
    group.push(player);
    brackets.set(player.matchPoints, group);
  }

  const ordered: RankedRegistration[] = [];
  for (const points of [...brackets.keys()].sort((a, b) => b - a)) {
    const group = brackets.get(points) ?? [];
    if (options.finalRound && options.powerPairFinalRound) {
      group.sort(compareStandingRows);
    } else {
      seededShuffle(
        group,
        createSeededRandom(
          pairingSeed(options.seed, options.roundNumber, points),
        ),
      );
    }
    ordered.push(...group);
  }
  return ordered;
}

// Bounds the backtracking search so a pathological field can never hang round
// generation; if exhausted we fall back to the greedy first-valid pass.
const MAX_PAIRING_STEPS = 200000;

// Pairs an even-sized, bracket-ordered list. Prefers a rematch-free pairing;
// when none exists, returns the pairing with the fewest unavoidable rematches
// rather than failing, so a round always generates.
function matchPairings(players: RankedRegistration[]): RankedMatch[] {
  if (players.length === 0) {
    return [];
  }
  const strict = strictBacktrack(players, { steps: 0 });
  if (strict) {
    return strict;
  }
  return minimizeRematches(players);
}

// Tier 1: first rematch-free perfect matching, or null. Because the list is
// bracket-ordered, the first valid opponent is the closest in standings, so
// Swiss float-down behavior is preserved.
function strictBacktrack(
  remaining: RankedRegistration[],
  budget: { steps: number },
): RankedMatch[] | null {
  if (remaining.length === 0) {
    return [];
  }
  budget.steps += 1;
  if (budget.steps > MAX_PAIRING_STEPS) {
    return null;
  }

  const [first, ...rest] = remaining;
  for (let index = 0; index < rest.length; index += 1) {
    const opponent = rest[index];
    if (first.opponentIds.has(opponent.registration._id)) {
      continue;
    }
    const sub = strictBacktrack(withoutIndex(rest, index), budget);
    if (sub) {
      return [{ playerOne: first, playerTwo: opponent }, ...sub];
    }
  }
  return null;
}

// Tier 2: branch-and-bound minimizing the number of repeat pairings. Cheap
// (new-opponent) candidates are tried first so a strong bound is found early
// and most rematch branches get pruned.
function minimizeRematches(players: RankedRegistration[]): RankedMatch[] {
  let best: RankedMatch[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const budget = { steps: 0 };

  const recurse = (
    remaining: RankedRegistration[],
    current: RankedMatch[],
    cost: number,
  ) => {
    if (cost >= bestCost || budget.steps > MAX_PAIRING_STEPS) {
      return;
    }
    if (remaining.length === 0) {
      best = [...current];
      bestCost = cost;
      return;
    }
    budget.steps += 1;

    const [first, ...rest] = remaining;
    const candidates = rest
      .map((opponent, index) => ({
        index,
        rematch: first.opponentIds.has(opponent.registration._id) ? 1 : 0,
      }))
      .sort((a, b) => a.rematch - b.rematch);

    for (const candidate of candidates) {
      if (cost + candidate.rematch >= bestCost) {
        continue;
      }
      current.push({ playerOne: first, playerTwo: rest[candidate.index] });
      recurse(
        withoutIndex(rest, candidate.index),
        current,
        cost + candidate.rematch,
      );
      current.pop();
    }
  };

  recurse(players, [], 0);
  return best ?? greedyFallback(players);
}

// Last-resort greedy first-valid pass (allows a rematch when cornered). Only
// reached if both backtracking tiers exhaust the step budget.
function greedyFallback(players: RankedRegistration[]): RankedMatch[] {
  const remaining = [...players];
  const matches: RankedMatch[] = [];
  while (remaining.length > 1) {
    const first = remaining.shift();
    if (!first) {
      break;
    }
    let opponentIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      if (!first.opponentIds.has(remaining[index].registration._id)) {
        opponentIndex = index;
        break;
      }
    }
    const opponent = remaining.splice(opponentIndex, 1)[0];
    matches.push({ playerOne: first, playerTwo: opponent });
  }
  return matches;
}

function withoutIndex<T>(items: T[], index: number): T[] {
  return items.filter((_, current) => current !== index);
}

// Fallback for registrations whose previous-round standings row predates the
// denormalized history fields (or who have no row, e.g. after reinstatement).
// Reads the player's whole tournament history: records and rematch avoidance
// carry across Swiss phases, and rows are bounded by the round cap (16) times
// the phase cap (16).
async function playerPairingHistory(
  ctx: QueryCtx,
  playerId: Id<"tournamentRegistrations">,
) {
  const rows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(256);

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
