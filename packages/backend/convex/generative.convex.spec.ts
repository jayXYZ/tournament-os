/// <reference types="vite/client" />

// Randomized/generative engine tests across field sizes, seeds, rounds,
// drops, and brackets. Every scenario derives from a fixed seed through the
// engine's own PRNG, so failures reproduce exactly; the seed and shape are
// rethrown in the failure message.

import { expect, test } from "vitest";

import type { BestOf } from "@tournament-os/shared/match-structure";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildSwissPairings,
  type Pairing,
  type PairingOptions,
  type RankedRegistration,
} from "./model/pairing";
import { createSeededRandom } from "./model/random";
import { planSingleEliminationPairings } from "./model/singleElimination";
import { compareStandingRows } from "./model/standings";
import { simulatedMatchResult } from "./model/testing";
import {
  insertLinkedParticipant,
  organizerIdentity,
  seedOrganizer,
} from "./specHelpers";
import {
  createConvexTest,
  expectStandingsMatchOracle,
} from "./specHelpers.runtime";

type Test = ReturnType<typeof createConvexTest>;
type Authed = ReturnType<Test["withIdentity"]>;

// Tallies what the full-tournament scenarios actually hit. The seeds are
// fixed, so the counts are deterministic; each test asserts its scenarios
// still exercised every mechanism it exists to cover, failing loudly if a
// generator change ever drains the randomness of its coverage.
const coverageProbe = {
  drops: 0,
  concessions: 0,
  byes: 0,
  walkoverByes: 0,
  guaranteedRematchFreeRounds: 0,
  draws: 0,
};

function resetCoverageProbe() {
  for (const key of Object.keys(
    coverageProbe,
  ) as (keyof typeof coverageProbe)[]) {
    coverageProbe[key] = 0;
  }
}

function expectScenarioCoverage(keys: (keyof typeof coverageProbe)[]) {
  for (const key of keys) {
    expect(coverageProbe[key], `scenarios exercised no ${key}`).toBeGreaterThan(
      0,
    );
  }
}

function rethrowWithScenario(context: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${context}: ${message}`, { cause: error });
}

// --- Pure Swiss pairing simulation ------------------------------------------
//
// Plays whole tournaments against buildSwissPairings alone, tracking points,
// opponents, byes, and drops in memory. No standings tiebreakers beyond match
// points are simulated — pairing only brackets on points, and the zeroed
// percentages make the standings order a deterministic function of the values
// we control.

type SimPlayer = {
  id: string;
  tiebreakRandom: number;
  matchPoints: number;
  opponentIds: Set<string>;
  byeCount: number;
  active: boolean;
};

function rankedFromSim(player: SimPlayer): RankedRegistration {
  return {
    registration: {
      _id: player.id as unknown as Id<"tournamentRegistrations">,
    } as Doc<"tournamentRegistrations">,
    matchPoints: player.matchPoints,
    opponentMatchWinPct: 0,
    gameWinPct: 0,
    opponentGameWinPct: 0,
    tiebreakRandom: player.tiebreakRandom,
    tiebreakId: player.id,
    opponentIds: new Set([
      ...player.opponentIds,
    ] as unknown as Id<"tournamentRegistrations">[]),
    byeCount: player.byeCount,
  };
}

function pairingSignature(pairings: Pairing[]): string {
  return pairings
    .map((pairing) =>
      pairing.isBye
        ? `bye:${pairing.playerOne._id}`
        : `${pairing.playerOne._id}v${pairing.playerTwo?._id}`,
    )
    .join(",");
}

function runPureSwissScenario(scenarioSeed: number) {
  const rng = createSeededRandom(scenarioSeed);
  const fieldSize = 3 + Math.floor(rng() * 30);
  const rounds = 3 + Math.floor(rng() * 5);
  const dropRate = [0, 0.05, 0.15][Math.floor(rng() * 3)];
  const powerPairFinalRound = rng() < 0.5;

  const players: SimPlayer[] = Array.from(
    { length: fieldSize },
    (_, index) => ({
      id: `P${String(index + 1).padStart(2, "0")}`,
      tiebreakRandom: Math.floor(rng() * 2 ** 32),
      matchPoints: 0,
      opponentIds: new Set<string>(),
      byeCount: 0,
      active: true,
    }),
  );
  const byId = new Map(players.map((player) => [player.id, player]));

  for (let roundNumber = 1; roundNumber <= rounds; roundNumber += 1) {
    const field = players.filter((player) => player.active);
    if (field.length < 2) {
      break;
    }
    const options: PairingOptions = {
      seed: scenarioSeed,
      roundNumber,
      finalRound: roundNumber === rounds,
      powerPairFinalRound,
    };
    const pairings = buildSwissPairings(field.map(rankedFromSim), options);

    // Deterministic for identical input.
    expect(
      pairingSignature(buildSwissPairings(field.map(rankedFromSim), options)),
    ).toBe(pairingSignature(pairings));

    // Every active player is placed exactly once (byes included).
    const placedIds = pairings.flatMap((pairing) =>
      pairing.isBye
        ? [pairing.playerOne._id as string]
        : [pairing.playerOne._id as string, pairing.playerTwo!._id as string],
    );
    expect(placedIds).toHaveLength(field.length);
    expect(new Set(placedIds).size).toBe(field.length);

    // Odd fields award exactly one bye, to the lowest-ranked player without
    // one (MTR), or the lowest-ranked overall once everyone has had one.
    const byes = pairings.filter((pairing) => pairing.isBye);
    expect(byes).toHaveLength(field.length % 2);
    if (byes.length === 1) {
      const standingsOrder = field.map(rankedFromSim).sort(compareStandingRows);
      let expected = standingsOrder[standingsOrder.length - 1];
      for (let index = standingsOrder.length - 1; index >= 0; index -= 1) {
        if (standingsOrder[index].byeCount === 0) {
          expected = standingsOrder[index];
          break;
        }
      }
      expect(byes[0].playerOne._id).toBe(expected.registration._id);
    }

    // When every paired player has met fewer than half of the paired field, a
    // rematch-free perfect matching provably exists (the allowed-opponents
    // graph has minimum degree ≥ half the field, so it is Hamiltonian), and
    // the matcher must find one.
    const matches = pairings.filter((pairing) => !pairing.isBye);
    const pairedIds = new Set(
      matches.flatMap((pairing) => [
        pairing.playerOne._id as string,
        pairing.playerTwo!._id as string,
      ]),
    );
    const maxPriorWithinField = Math.max(
      0,
      ...[...pairedIds].map(
        (id) =>
          [...byId.get(id)!.opponentIds].filter((opponent) =>
            pairedIds.has(opponent),
          ).length,
      ),
    );
    if (maxPriorWithinField < pairedIds.size / 2) {
      for (const pairing of matches) {
        expect(
          byId
            .get(pairing.playerOne._id as string)!
            .opponentIds.has(pairing.playerTwo!._id as string),
        ).toBe(false);
      }
    }

    // Apply random results and drops for the next round.
    for (const pairing of pairings) {
      const one = byId.get(pairing.playerOne._id as string)!;
      if (pairing.isBye) {
        one.matchPoints += 3;
        one.byeCount += 1;
        continue;
      }
      const two = byId.get(pairing.playerTwo!._id as string)!;
      one.opponentIds.add(two.id);
      two.opponentIds.add(one.id);
      const roll = rng();
      if (roll < 0.1) {
        one.matchPoints += 1;
        two.matchPoints += 1;
      } else if (roll < 0.55) {
        one.matchPoints += 3;
      } else {
        two.matchPoints += 3;
      }
    }
    for (const player of players) {
      if (!player.active) {
        continue;
      }
      if (players.filter((candidate) => candidate.active).length <= 3) {
        break;
      }
      if (rng() < dropRate) {
        player.active = false;
      }
    }
  }
}

test("randomized Swiss fields uphold pairing invariants across seeds", () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    try {
      runPureSwissScenario(seed);
    } catch (error) {
      rethrowWithScenario(`pure Swiss scenario seed ${seed}`, error);
    }
  }
});

// --- Random walkover plans ---------------------------------------------------

function runBracketPlanScenario(scenarioSeed: number) {
  const rng = createSeededRandom(scenarioSeed);
  const seatCount = 1 + Math.floor(rng() * 16);
  const dropRate = 0.1 + rng() * 0.5;
  const seats = Array.from(
    { length: seatCount },
    (_, index) =>
      ({
        _id: `S${index}` as unknown as Id<"tournamentRegistrations">,
        participationStatus: rng() < dropRate ? "dropped" : "active",
      }) as Doc<"tournamentRegistrations">,
  );
  const seatIndex = new Map(seats.map((seat, index) => [seat._id, index]));

  const pairings = planSingleEliminationPairings(seats);

  // Every live seat plays exactly once; nobody dead is revived into a slot.
  const participants = pairings.flatMap((pairing) =>
    pairing.isBye
      ? [pairing.playerOne._id]
      : [pairing.playerOne._id, pairing.playerTwo!._id],
  );
  const liveIds = seats
    .filter((seat) => seat.participationStatus === "active")
    .map((seat) => seat._id);
  expect([...participants].sort()).toEqual([...liveIds].sort());

  for (const pairing of pairings) {
    const oneIndex = seatIndex.get(pairing.playerOne._id)!;
    if (!pairing.isBye) {
      // Matches only ever pair scheduled (adjacent-seat) opponents.
      expect(Math.floor(seatIndex.get(pairing.playerTwo!._id)! / 2)).toBe(
        Math.floor(oneIndex / 2),
      );
    } else {
      // A bye is only awarded when the scheduled opponent's seat is empty.
      const partner = seats[oneIndex ^ 1];
      expect(
        partner === undefined || partner.participationStatus !== "active",
      ).toBe(true);
    }
  }
}

test("random walkover plans pair only live, scheduled opponents", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    try {
      runBracketPlanScenario(seed);
    } catch (error) {
      rethrowWithScenario(`walkover plan scenario seed ${seed}`, error);
    }
  }
});

// --- Randomized full tournaments through the real mutations ------------------

type FullScenario = {
  seed: number;
  fieldSize: number;
  swissRounds: number;
  bestOf: BestOf;
  midDropRate: number;
  betweenDropRate: number;
  bracket: boolean;
};

function deriveFullScenario(
  seed: number,
  options: { bracket: boolean; forceOddField: boolean },
): FullScenario {
  const rng = createSeededRandom(seed);
  let fieldSize = options.bracket
    ? 12 + Math.floor(rng() * 13)
    : 8 + Math.floor(rng() * 17);
  if (options.forceOddField && fieldSize % 2 === 0) {
    fieldSize += 1;
  }
  return {
    seed,
    fieldSize,
    swissRounds: 3 + Math.floor(rng() * (options.bracket ? 2 : 3)),
    bestOf: ([1, 3, 5] as const)[Math.floor(rng() * 3)],
    midDropRate: 0.05 + rng() * 0.15,
    betweenDropRate: 0.05 + rng() * 0.1,
    bracket: options.bracket,
  };
}

async function seedGenerativeField(
  t: Test,
  tournamentId: Id<"tournaments">,
  count: number,
  rng: () => number,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    for (let playerNumber = 1; playerNumber <= count; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `player:${playerNumber}`,
        publicCode: playerNumber,
        email: `player${playerNumber}@example.test`,
        name: `Player ${playerNumber}`,
        updatedAt: now,
      });
      const participant0Id = await insertLinkedParticipant(ctx, userId);
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        participantId: participant0Id,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName: `Player ${playerNumber}`,
        createdAt: now + playerNumber,
        tiebreakRandom: Math.floor(rng() * 2 ** 32),
        updatedAt: now,
      });
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: tournament.confirmedRegistrationCount + count,
    });
  });
}

async function activeFieldRegistrations(
  t: Test,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
          q.eq("tournamentId", tournamentId),
        )
        .collect()
    )
      .filter((registration) => registration.participationStatus === "active")
      .sort((left, right) => left.createdAt - right.createdAt),
  );
}

// Drops a random subset of active players through the organizer mutation,
// never below `floor` remaining and never more than `maxDrops`.
async function maybeDropPlayers(
  t: Test,
  authed: Authed,
  tournamentId: Id<"tournaments">,
  rng: () => number,
  options: { rate: number; floor: number; maxDrops?: number },
) {
  const active = await activeFieldRegistrations(t, tournamentId);
  let remaining = active.length;
  let drops = 0;
  for (const registration of active) {
    if (remaining <= options.floor || drops >= (options.maxDrops ?? Infinity)) {
      break;
    }
    if (rng() < options.rate) {
      await authed.mutation(api.tournaments.registrations.dropRegistration, {
        registrationId: registration._id,
      });
      remaining -= 1;
      drops += 1;
      coverageProbe.drops += 1;
    }
  }
}

// Records a simulator scoreline for every unfinished two-player match of the
// round (matches a mid-round drop already conceded are left alone).
async function recordRandomResults(
  authed: Authed,
  rng: () => number,
  roundId: Id<"tournamentRounds">,
  options: { bestOf: BestOf; allowDraws: boolean },
) {
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId,
    },
  );
  for (const { match, players } of pairings) {
    if (players.length !== 2 || match.matchStatus === "completed") {
      if (players.length === 2) {
        coverageProbe.concessions += 1;
      }
      continue;
    }
    const result = simulatedMatchResult(rng, options);
    if (result.draws > 0) {
      coverageProbe.draws += 1;
    }
    await authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: result.playerOneGameWins,
      playerTwoGameWins: result.playerTwoGameWins,
      gameDraws: result.draws,
    });
  }
}

function advancementValue(row: Doc<"roundStandings">, roundNumber: number) {
  if (row.playoffStatus === "active") {
    return roundNumber + 1;
  }
  if (row.playoffStatus === "eliminated") {
    return row.eliminatedInRoundNumber ?? 0;
  }
  return -1;
}

// Playoff standings must rank by bracket advancement before tiebreakers: the
// further a seat went, the higher its holder stands.
async function expectPlayoffAdvancementOrder(
  t: Test,
  roundId: Id<"tournamentRounds">,
  roundNumber: number,
) {
  await t.run(async (ctx) => {
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", roundId),
      )
      .collect();
    const values = standings.map((row) => advancementValue(row, roundNumber));
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeLessThanOrEqual(values[index - 1]);
    }
  });
}

type SwissRoundFacts = {
  roundId: Id<"tournamentRounds">;
  byePlayerIds: Id<"tournamentRegistrations">[];
  pairKeys: string[];
  participantIds: Id<"tournamentRegistrations">[];
};

async function currentRoundFacts(
  authed: Authed,
  tournamentId: Id<"tournaments">,
  expectedRoundNumber: number,
): Promise<SwissRoundFacts & { round: Doc<"tournamentRounds"> }> {
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(round?.roundNumber).toBe(expectedRoundNumber);
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId: round!._id,
    },
  );
  const byePlayerIds: Id<"tournamentRegistrations">[] = [];
  const pairKeys: string[] = [];
  const participantIds: Id<"tournamentRegistrations">[] = [];
  for (const { players } of pairings) {
    participantIds.push(...players.map((player) => player.playerId));
    if (players.length === 1 && players[0].isBye) {
      byePlayerIds.push(players[0].playerId);
    }
    if (players.length === 2) {
      pairKeys.push(
        players
          .map((player) => player.playerId)
          .sort()
          .join("|"),
      );
    }
  }
  return {
    round: round!,
    roundId: round!._id,
    byePlayerIds,
    pairKeys,
    participantIds,
  };
}

// Plays every Swiss round of the scenario: random mid-round drops (conceding
// unfinished matches), random results, round completion checked against the
// standings oracle, and random between-round drops. Returns the final Swiss
// round's id.
async function playSwissPhase(
  t: Test,
  authed: Authed,
  tournamentId: Id<"tournaments">,
  scenario: FullScenario,
  rng: () => number,
) {
  const dropFloor = scenario.bracket ? 8 : 4;
  const byeCounts = new Map<Id<"tournamentRegistrations">, number>();
  const seenPairKeys = new Set<string>();
  let finalRoundId: Id<"tournamentRounds"> | null = null;

  for (
    let roundNumber = 1;
    roundNumber <= scenario.swissRounds;
    roundNumber += 1
  ) {
    const facts = await currentRoundFacts(authed, tournamentId, roundNumber);
    finalRoundId = facts.roundId;

    // Every participant appears exactly once, and odd fields get one bye.
    expect(new Set(facts.participantIds).size).toBe(
      facts.participantIds.length,
    );
    expect(facts.byePlayerIds.length).toBe(facts.participantIds.length % 2);

    // The bye goes to a player without one until every participant has one.
    for (const byePlayerId of facts.byePlayerIds) {
      const everyoneHasABye = facts.participantIds.every(
        (playerId) => (byeCounts.get(playerId) ?? 0) > 0,
      );
      expect((byeCounts.get(byePlayerId) ?? 0) === 0 || everyoneHasABye).toBe(
        true,
      );
      byeCounts.set(byePlayerId, (byeCounts.get(byePlayerId) ?? 0) + 1);
    }

    // With fewer prior rounds than matches, a rematch-free pairing provably
    // exists (see the pure-simulation test), so none may appear.
    if (roundNumber - 1 < facts.pairKeys.length) {
      coverageProbe.guaranteedRematchFreeRounds += 1;
      for (const key of facts.pairKeys) {
        expect(seenPairKeys.has(key)).toBe(false);
      }
    }
    coverageProbe.byes += facts.byePlayerIds.length;
    for (const key of facts.pairKeys) {
      seenPairKeys.add(key);
    }

    await maybeDropPlayers(t, authed, tournamentId, rng, {
      rate: scenario.midDropRate,
      floor: dropFloor,
    });
    await recordRandomResults(authed, rng, facts.roundId, {
      bestOf: scenario.bestOf,
      allowDraws: true,
    });
    await authed.mutation(api.tournaments.rounds.completeRound, {
      roundId: facts.roundId,
    });
    await expectStandingsMatchOracle(
      t,
      tournamentId,
      facts.roundId,
      roundNumber,
      { assertRankOrder: true },
    );

    if (roundNumber < scenario.swissRounds) {
      await maybeDropPlayers(t, authed, tournamentId, rng, {
        rate: scenario.betweenDropRate,
        floor: dropFloor,
      });
      await authed.mutation(api.tournaments.rounds.generateNextRound, {
        tournamentId,
      });
    }
  }
  return finalRoundId!;
}

async function createFullScenarioTournament(
  t: Test,
  scenario: FullScenario,
  rng: () => number,
) {
  const { organizationId } = await seedOrganizer(t, 100000);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: `Generative Event ${scenario.seed}`,
      startDate: Date.now(),
      playerCapacity: scenario.fieldSize,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: scenario.swissRounds,
          bestOf: scenario.bestOf,
        },
        ...(scenario.bracket
          ? [
              {
                phaseOrder: 2,
                phaseType: "single_elimination" as const,
                phaseRoundMode: "fixed" as const,
                bestOf: scenario.bestOf,
              },
            ]
          : []),
      ],
    },
  );
  await seedGenerativeField(t, tournamentId, scenario.fieldSize, rng);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  return { authed, tournamentId };
}

async function runRandomizedSwissTournament(scenario: FullScenario) {
  const rng = createSeededRandom(scenario.seed * 7919 + 17);
  const t = createConvexTest();
  const { authed, tournamentId } = await createFullScenarioTournament(
    t,
    scenario,
    rng,
  );

  await playSwissPhase(t, authed, tournamentId, scenario, rng);
  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
}

const BRACKET_SEED_PAIRS = [
  [0, 7],
  [3, 4],
  [1, 6],
  [2, 5],
] as const;

async function runRandomizedBracketTournament(scenario: FullScenario) {
  const rng = createSeededRandom(scenario.seed * 7919 + 17);
  const t = createConvexTest();
  const { authed, tournamentId } = await createFullScenarioTournament(
    t,
    scenario,
    rng,
  );

  const finalSwissRoundId = await playSwissPhase(
    t,
    authed,
    tournamentId,
    scenario,
    rng,
  );

  // Drops between the Swiss finish and the cut must be skipped by the cut.
  await maybeDropPlayers(t, authed, tournamentId, rng, {
    rate: scenario.betweenDropRate,
    floor: 8,
  });
  const expectedSeeds = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalSwissRoundId,
    })
  )
    .filter(({ registrationStatus }) => registrationStatus === "active")
    .slice(0, 8)
    .map(({ standing }) => standing.playerId);
  expect(expectedSeeds).toHaveLength(8);

  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // The quarterfinal is the standard-seeded bracket over the top eight active
  // players, and everyone else is out of contention.
  const quarterfinal = await currentRoundFacts(
    authed,
    tournamentId,
    scenario.swissRounds + 1,
  );
  expect(quarterfinal.round.roundName).toBe("Quarterfinals");
  expect(quarterfinal.pairKeys).toHaveLength(4);
  expect(quarterfinal.pairKeys).toEqual(
    BRACKET_SEED_PAIRS.map(([high, low]) =>
      [expectedSeeds[high], expectedSeeds[low]].sort().join("|"),
    ),
  );
  expect(await activeFieldRegistrations(t, tournamentId)).toHaveLength(8);

  const bracketRoundNames = ["Quarterfinals", "Semifinals", "Finals"];
  let finalsRoundId: Id<"tournamentRounds"> | null = null;
  for (let roundInPhase = 1; roundInPhase <= 3; roundInPhase += 1) {
    const roundNumber = scenario.swissRounds + roundInPhase;
    const facts = await currentRoundFacts(authed, tournamentId, roundNumber);
    expect(facts.round.roundName).toBe(bracketRoundNames[roundInPhase - 1]);
    finalsRoundId = facts.roundId;
    coverageProbe.walkoverByes += facts.byePlayerIds.length;

    // A mid-round bracket drop concedes the player's unfinished match.
    await maybeDropPlayers(t, authed, tournamentId, rng, {
      rate: 0.3,
      floor: 1,
      maxDrops: 1,
    });
    await recordRandomResults(authed, rng, facts.roundId, {
      bestOf: scenario.bestOf,
      allowDraws: false,
    });
    await authed.mutation(api.tournaments.rounds.completeRound, {
      roundId: facts.roundId,
    });
    await expectStandingsMatchOracle(
      t,
      tournamentId,
      facts.roundId,
      roundNumber,
      {
        assertRankOrder: false,
      },
    );
    await expectPlayoffAdvancementOrder(t, facts.roundId, roundNumber);

    if (roundInPhase < 3) {
      // A seat winner dropping between rounds hands the scheduled opponent a
      // walkover at the next pairing. At most one per boundary, so at least
      // one live seat always remains and the bracket stays pairable.
      await maybeDropPlayers(t, authed, tournamentId, rng, {
        rate: 0.3,
        floor: 1,
        maxDrops: 1,
      });
      await authed.mutation(api.tournaments.rounds.generateNextRound, {
        tournamentId,
      });
    }
  }

  // The champion is the finals' game winner (a walkover final's lone player),
  // whatever their participation status ended up as.
  const finalsWinnerId = await t.run(async (ctx) => {
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", finalsRoundId!),
      )
      .collect();
    expect(matches).toHaveLength(1);
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matches[0]._id),
      )
      .collect();
    if (players.length === 1) {
      return players[0].playerId;
    }
    const [first, second] = players;
    return (first.gameWins ?? 0) > (second.gameWins ?? 0)
      ? first.playerId
      : second.playerId;
  });
  const finalStandings = await authed.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: finalsRoundId! },
  );
  expect(finalStandings[0].standing.playerId).toBe(finalsWinnerId);
  expect(finalStandings).toHaveLength(scenario.fieldSize);

  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
}

test("randomized Swiss tournaments with drops match the standings oracle end-to-end", async () => {
  resetCoverageProbe();
  for (let index = 0; index < 4; index += 1) {
    const scenario = deriveFullScenario(1000 + index, {
      bracket: false,
      forceOddField: index % 2 === 0,
    });
    try {
      await runRandomizedSwissTournament(scenario);
    } catch (error) {
      rethrowWithScenario(
        `randomized Swiss scenario ${JSON.stringify(scenario)}`,
        error,
      );
    }
  }
  expectScenarioCoverage([
    "drops",
    "concessions",
    "byes",
    "draws",
    "guaranteedRematchFreeRounds",
  ]);
}, 180_000);

test("randomized Swiss→top-8 tournaments with drops cut, bracket, and complete correctly", async () => {
  resetCoverageProbe();
  for (let index = 0; index < 3; index += 1) {
    const scenario = deriveFullScenario(2000 + index, {
      bracket: true,
      forceOddField: index % 2 === 0,
    });
    try {
      await runRandomizedBracketTournament(scenario);
    } catch (error) {
      rethrowWithScenario(
        `randomized bracket scenario ${JSON.stringify(scenario)}`,
        error,
      );
    }
  }
  expectScenarioCoverage([
    "drops",
    "concessions",
    "byes",
    "draws",
    "guaranteedRematchFreeRounds",
    "walkoverByes",
  ]);
}, 180_000);
