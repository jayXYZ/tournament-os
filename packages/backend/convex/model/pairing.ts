import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { materializeAwardedByeMatch } from "./matchResults";
import {
  MAX_MATCHES_PER_PLAYER,
  requireResolvedPhaseTotalRounds,
  roundNumberInPhase,
} from "./phases";
import { createSeededRandom, pairingSeed, seededShuffle } from "./random";
import {
  compareStandingRows,
  hasCumulativeTotals,
  standingsInRankOrder,
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
  tiebreakRandom: number;
  tiebreakId: string;
  opponentIds: Set<Id<"tournamentRegistrations">>;
  byeCount: number;
};

export type Pairing = {
  playerOne: Doc<"tournamentRegistrations">;
  playerTwo?: Doc<"tournamentRegistrations">;
  isBye: boolean;
};

// The standard bracket order for a power-of-two field (1v8, 4v5, 2v7, 3v6
// for eight, generalized): grown by repeatedly expanding each seed s in a
// round of n seats to the pair (s, n+1-s), so seed 1 meets the lowest seed
// and the top seeds stay in opposite halves through the final.
function standardBracketOrder(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) {
    const roundSize = seeds.length * 2;
    seeds = seeds.flatMap((seed) => [seed, roundSize + 1 - seed]);
  }
  return seeds.map((seed) => seed - 1);
}

// The seeding order for a bracket no standings precede — a single-elimination
// first phase (CONTEXT.md "Bracket"): the tournament's random seed decides it,
// through the same per-player random that breaks perfect standings ties
// (model/random.ts). The order matches what compareStandingRows produces for
// an all-zero field, and is fixed for the whole tournament by construction —
// a rewound first round re-pairs the identical bracket.
export function firstPhaseBracketSeedOrder(
  registrations: Doc<"tournamentRegistrations">[],
): Doc<"tournamentRegistrations">[] {
  return [...registrations].sort(
    (left, right) =>
      right.tiebreakRandom - left.tiebreakRandom ||
      (left._id as string).localeCompare(right._id as string),
  );
}

// Seeds occupy a fixed standard bracket: the smallest power of two that fits
// the field (CONTEXT.md "Bracket"). A field that doesn't fill it exactly
// leaves its lowest seats empty, and each empty seat's scheduled opponent —
// by construction the highest seeds — takes a first-round bye. Keeping
// matches in this table order makes later rounds a simple adjacent-winner
// pairing without a reseed, preserving the halves of the bracket through the
// final.
export function buildSingleEliminationPairings(
  registrationsBySeed: Doc<"tournamentRegistrations">[],
): Pairing[] {
  const fieldSize = registrationsBySeed.length;
  if (fieldSize < 2) {
    throw new Error("Single elimination requires at least two seeded players");
  }
  const bracketSize = 2 ** Math.ceil(Math.log2(fieldSize));
  const bracket = standardBracketOrder(bracketSize).map((seedIndex) =>
    registrationsBySeed.at(seedIndex),
  );
  const pairings: Pairing[] = [];
  for (let index = 0; index < bracket.length; index += 2) {
    const one = bracket[index];
    const two = bracket[index + 1];
    if (!one) {
      // standardBracketOrder puts each pair's higher seed first, and the
      // smallest fitting bracket fills more than half its seats, so a pair's
      // first seat always holds a player.
      throw new Error("Bracket pair is missing its higher seed");
    }
    pairings.push(
      two
        ? { playerOne: one, playerTwo: two, isBye: false }
        : { playerOne: one, isBye: true },
    );
  }
  return pairings;
}

// Materializes a bracket round from an already-built pairing plan: the seeded
// first-round bracket, or the walkover-aware advancement plan from
// planSingleEliminationPairings (model/singleElimination.ts). A bye pairing
// is a walkover — the same awarded Bye a Swiss bye records. The plan's order
// is the bracket's seat order, stamped onto every match (byes included) as
// bracketSeat so the next round's pairing can read the seats back in bracket
// order — the table index can't supply it, since byes have no table.
export async function createSingleEliminationRoundWithPairings(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundNumber: number;
    roundName: string;
    pairings: Pairing[];
  },
) {
  if (args.pairings.length === 0) {
    throw new Error("Single-elimination round requires at least one match");
  }
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

  let tableNumber = 1;
  for (const [seatIndex, pairing] of args.pairings.entries()) {
    if (pairing.isBye || !pairing.playerTwo) {
      await materializeAwardedByeMatch(ctx, {
        tournament: args.tournament,
        phase: args.phase,
        roundId,
        registration: pairing.playerOne,
        bracketSeat: seatIndex + 1,
        now,
      });
      continue;
    }
    await insertPairedMatch(ctx, {
      tournament: args.tournament,
      phase: args.phase,
      roundId,
      playerOne: pairing.playerOne,
      playerTwo: pairing.playerTwo,
      tableNumber,
      bracketSeat: seatIndex + 1,
      now,
    });
    tableNumber += 1;
  }
  return roundId;
}

// Inserts one contested match and its two pairing rows — the shared write for
// Swiss and bracket rounds, and for organizer manual pairings
// (model/manualPairing.ts). Byes never reach here (materializeAwardedByeMatch
// owns awarded results).
export async function insertPairedMatch(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundId: Id<"tournamentRounds">;
    playerOne: Doc<"tournamentRegistrations">;
    playerTwo: Doc<"tournamentRegistrations">;
    tableNumber: number;
    // The pairing's seat position in a bracket round; absent for Swiss.
    bracketSeat?: number;
    now: number;
  },
) {
  const matchId = await ctx.db.insert("tournamentMatches", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    tournamentRoundId: args.roundId,
    tableNumber: args.tableNumber,
    bracketSeat: args.bracketSeat,
    matchStatus: "upcoming",
    updatedAt: args.now,
  });
  await ctx.db.insert("tournamentMatchPlayers", {
    tournamentMatchId: matchId,
    playerId: args.playerOne._id,
    playerName: args.playerOne.playerName,
    opponentPlayerId: args.playerTwo._id,
    isBye: false,
    updatedAt: args.now,
  });
  await ctx.db.insert("tournamentMatchPlayers", {
    tournamentMatchId: matchId,
    playerId: args.playerTwo._id,
    playerName: args.playerTwo.playerName,
    opponentPlayerId: args.playerOne._id,
    isBye: false,
    updatedAt: args.now,
  });
  return matchId;
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
    if (pairing.isBye) {
      await materializeAwardedByeMatch(ctx, {
        tournament: args.tournament,
        phase: args.phase,
        roundId,
        registration: pairing.playerOne,
        now,
      });
      continue;
    }
    if (!pairing.playerTwo) {
      continue;
    }
    await insertPairedMatch(ctx, {
      tournament: args.tournament,
      phase: args.phase,
      roundId,
      playerOne: pairing.playerOne,
      playerTwo: pairing.playerTwo,
      tableNumber,
      now,
    });
    tableNumber += 1;
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
      .map((registration) => ({
        registration,
        matchPoints: 0,
        opponentMatchWinPct: 0,
        gameWinPct: 0,
        opponentGameWinPct: 0,
        tiebreakRandom: registration.tiebreakRandom,
        tiebreakId: registration._id as string,
        opponentIds: new Set<Id<"tournamentRegistrations">>(),
        byeCount: 0,
      }))
      .sort(compareStandingRows);
  }

  const standings = await standingsInRankOrder(ctx, args.previousRoundId);
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
            byeCount: standing.byeCount ?? 0,
          }
        : await playerPairingHistory(ctx, registration._id);

    ranked.push({
      registration,
      matchPoints: standing?.matchPoints ?? 0,
      opponentMatchWinPct: standing?.opponentMatchWinPct ?? 0,
      gameWinPct: standing?.gameWinPct ?? 0,
      opponentGameWinPct: standing?.opponentGameWinPct ?? 0,
      tiebreakRandom: registration.tiebreakRandom,
      tiebreakId: registration._id as string,
      ...history,
    });
  }

  return ranked.sort(compareStandingRows);
}

export function buildSwissPairings(
  rankedRegistrations: RankedRegistration[],
  options: PairingOptions,
): Pairing[] {
  // Standings order is used for the bye choice (our rule — the MTR is silent
  // on bye assignment; see CONTEXT.md "Bye"), then handed to orderForPairing
  // for the within-bracket shuffle.
  const standingsSorted = [...rankedRegistrations].sort(compareStandingRows);
  const pairings: Pairing[] = [];

  if (standingsSorted.length % 2 === 1) {
    let byeIndex = standingsSorted.length - 1;
    for (let index = standingsSorted.length - 1; index >= 0; index -= 1) {
      if (standingsSorted[index].byeCount === 0) {
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
// carry across Swiss phases, and rows are bounded by the round cap times the
// phase cap (MAX_MATCHES_PER_PLAYER).
async function playerPairingHistory(
  ctx: QueryCtx,
  playerId: Id<"tournamentRegistrations">,
) {
  const rows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(MAX_MATCHES_PER_PLAYER);

  const opponentIds = new Set<Id<"tournamentRegistrations">>();
  for (const row of rows) {
    if (row.opponentPlayerId) {
      opponentIds.add(row.opponentPlayerId);
    }
  }

  return {
    opponentIds,
    byeCount: rows.filter((row) => row.isBye).length,
  };
}
