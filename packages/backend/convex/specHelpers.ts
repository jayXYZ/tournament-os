// Scaffolding shared by the *.convex.spec.ts suites. convex-test and the
// schema are imported as types only, so this module stays inert if the Convex
// CLI ever bundles it alongside the deployed functions.
import type { TestConvex } from "convex-test";
import type { FunctionArgs } from "convex/server";

import { requiredGameWins } from "@paper-pairings/shared/match-structure";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { nextUserPublicCode } from "./model/users";
import type schema from "./schema";

// Resolves to whatever `call` rejected with, so a refused mutation runs once
// and the same rejection can be checked for both its class (UserError or a
// plain Error — see model/errors.ts) and its payload. Fails the test if the
// call resolves instead.
export async function rejection(call: Promise<unknown>): Promise<unknown> {
  return await call.then(
    () => {
      throw new Error("Expected the call to reject");
    },
    (error: unknown) => error,
  );
}

// The labeled escape hatch for fixture state the public mutations cannot
// produce. Scenario helpers build through the same mutations real clients
// call, so a fixture cannot drift from write policy; a raw write here must
// name the invariant it deliberately sidesteps, and must not repair a counter
// or stamp the scenario is meant to exercise.
export async function rawSeed<T>(
  t: TestConvex<typeof schema>,
  reason: string,
  seed: (ctx: MutationCtx) => Promise<T>,
): Promise<T> {
  if (!reason.trim()) {
    throw new Error("A raw seed must say why the public seam can't build it");
  }
  return await t.run(seed);
}

// Registrations belong to participants (ADR 0002), so spec seeding that
// inserts registrations directly must create the identity hop registerSelf
// performs: a participant row linked to the player's user account.
// Get-or-create, because exactly one participant may exist per user and
// suites seed the same user into several tournaments.
export async function insertLinkedParticipant(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"participants">> {
  const existing = await ctx.db
    .query("participants")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    return existing._id;
  }
  return await ctx.db.insert("participants", {
    userId,
    updatedAt: Date.now(),
  });
}

export const organizerIdentity = {
  issuer: "https://convex.test",
  subject: "organizer",
  tokenIdentifier: "https://convex.test|organizer",
  email: "organizer@example.test",
  name: "Organizer",
};

// The 1-based numbered player identity every suite seeds players from.
export function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

// Seeds the organizer user, with an owned active organization, that every
// suite starts from. By default the organizer's code comes from the allocator
// upsertUser numbers accounts from (1 in a fresh test), so accounts later
// created through upsertMe or registerSelf never share it. Suites that also
// seed players by hand pass a publicCode above their players' range so the
// manually assigned codes never collide.
export async function seedOrganizer(
  t: TestConvex<typeof schema>,
  publicCode?: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      publicCode: publicCode ?? (await nextUserPublicCode(ctx, now)),
      email: organizerIdentity.email,
      name: organizerIdentity.name,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Test Org",
      slug: "test-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      email: organizerIdentity.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });

    return { organizationId, userId };
  });
}

// Records a sweep at the phase's best-of for the listed player one in every
// open two-player match of the current round, then completes the round. Byes
// and results already on the board (a drop concession, a report) stand. The
// organizer records against unpublished pairings, and completeRound publishes
// a held round as part of the record, so no explicit publication happens
// here: suites that audit the publication seam see only what the lifecycle
// writes. Returns the round and each match's unordered registration-id pair
// for rematch assertions.
export async function playOutCurrentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round to play out");
  }
  const { phases } = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  const phase = phases.find((item) => item._id === round.tournamentPhaseId);
  if (!phase) {
    throw new Error("Current round's phase not found");
  }
  const gameWins = requiredGameWins(phase.bestOf);
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  const pairKeys: string[] = [];
  for (const { match, players } of pairings) {
    if (players.length !== 2) {
      continue;
    }
    pairKeys.push(
      players
        .map((player) => player.playerId)
        .sort()
        .join("+"),
    );
    if (match.matchStatus !== "upcoming") {
      continue;
    }
    await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: gameWins,
      playerTwoGameWins: 0,
    });
  }
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
  return { round, pairKeys };
}

type TournamentPhaseInputs = FunctionArgs<
  typeof api.tournaments.lifecycle.createTournamentWithPhases
>["phases"];

// Creates and publishes a phased tournament, then admits playerCount players
// (numbered 1..N as playerIdentity numbers) through registerSelf, so their
// accounts, participants, registrations, name stamps, the confirmed count, and
// the player_registered audit events all come from production writes.
// Capacity grows to fit the field. The knobs cover the ways suites
// deliberately shape it:
//   - tiebreak "descending" makes equal records rank in player-number order
//     (keeping e.g. the round-one bye on the highest player number);
//     "ascending" reverses that.
//   - playerNames replaces the identities' "Player N" names, in player order;
//     each reaches the account and the registration's stamps the way a
//     provider name does at sign-in.
export async function seedTournamentWithPlayers(
  t: TestConvex<typeof schema>,
  options: {
    name: string;
    playerCount: number;
    phases?: TournamentPhaseInputs;
    autoPublishPairings?: boolean;
    tiebreak?: "ascending" | "descending";
    playerNames?: string[];
  },
) {
  const {
    name,
    playerCount,
    phases = [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    autoPublishPairings = true,
    tiebreak = "ascending",
    playerNames,
  } = options;
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name,
      startDate: Date.now(),
      playerCapacity: Math.max(16, playerCount),
      format: "standard",
      phases,
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    {
      tournamentId,
      autoPublishPairings,
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const registrationIds = await registerPlayers(t, tournamentId, playerCount, {
    tiebreak,
    playerNames,
  });

  return { tournamentId, registrationIds };
}

// Players 1..playerCount (playerIdentity numbers) each register themselves
// for a tournament open for registration, exactly as a signed-in player
// does: registerSelf creates the account, participant, and stamped row,
// takes the seat, and logs player_registered. Options as for
// seedTournamentWithPlayers; tiebreak defaults to "ascending", and a
// function supplies each player's value from their number instead (called
// in player order, so a seeded generator stays reproducible).
export async function registerPlayers(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  playerCount: number,
  options: {
    tiebreak?: "ascending" | "descending" | ((playerNumber: number) => number);
    playerNames?: string[];
  } = {},
): Promise<Id<"tournamentRegistrations">[]> {
  const { tiebreak = "ascending", playerNames } = options;
  const tiebreakFor =
    typeof tiebreak === "function"
      ? tiebreak
      : tiebreak === "descending"
        ? (playerNumber: number) => 100_000 - playerNumber
        : (playerNumber: number) => playerNumber;
  const registrationIds: Id<"tournamentRegistrations">[] = [];
  for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
    const identity = playerIdentity(playerNumber);
    const player = t.withIdentity({
      ...identity,
      name: playerNames?.[playerNumber - 1] ?? identity.name,
    });
    registrationIds.push(
      await player.mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
      }),
    );
  }
  await rawSeed(
    t,
    "registerSelf hashes the tournament seed with each player's code into tiebreakRandom; the scenario pins it so equal records rank in a chosen order",
    async (ctx) => {
      for (const [index, registrationId] of registrationIds.entries()) {
        await ctx.db.patch(registrationId, {
          tiebreakRandom: tiebreakFor(index + 1),
        });
      }
    },
  );
  return registrationIds;
}

// The player's match in the given round of the tournament.
export async function matchForPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  roundNumber: number,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => {
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
      .take(16);
    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        continue;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (round?.roundNumber === roundNumber) {
        return match;
      }
    }
    throw new Error("Match not found in test setup");
  });
}

// Resolves the opponent's 1-based player number in a two-player match, so
// tests don't depend on which pairing the seeded shuffle produced.
export async function opponentNumber(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
  myRegistrationId: Id<"tournamentRegistrations">,
  registrationIds: Id<"tournamentRegistrations">[],
) {
  const opponentId = await t.run(async (ctx) => {
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2);
    return (
      players.find((player) => player.playerId !== myRegistrationId)
        ?.playerId ?? null
    );
  });
  const index = opponentId ? registrationIds.indexOf(opponentId) : -1;
  if (index < 0) {
    throw new Error("Opponent not found for match");
  }
  return index + 1;
}

// A registered player who is not in the given match (e.g. someone playing at
// another table), for outsider-rejection and cross-table checks.
export async function outsiderNumber(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
  registrationIds: Id<"tournamentRegistrations">[],
) {
  const participantIds = await t.run(async (ctx) => {
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2);
    return players.map((player) => player.playerId);
  });
  const index = registrationIds.findIndex((id) => !participantIds.includes(id));
  if (index < 0) {
    throw new Error("No outsider available for match");
  }
  return index + 1;
}

// The first phase's current round, straight from the database.
export async function currentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const phase = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
      )
      .unique();
    const round = await ctx.db.get(phase!.phaseCurrentRound!);
    if (!round) {
      throw new Error("Current round missing in test setup");
    }
    return round;
  });
}
