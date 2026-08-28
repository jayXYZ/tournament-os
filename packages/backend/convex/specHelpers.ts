// Scaffolding shared by the *.convex.spec.ts suites. convex-test and the
// schema are imported as types only, so this module stays inert if the Convex
// CLI ever bundles it alongside the deployed functions.
import type { TestConvex } from "convex-test";
import type { FunctionArgs } from "convex/server";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type schema from "./schema";

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
// suite starts from. Suites that also seed players by hand pass a publicCode
// above their players' range so the manually assigned codes never collide.
export async function seedOrganizer(
  t: TestConvex<typeof schema>,
  publicCode = 1,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      publicCode,
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

// Records a 2-0 win for player one in every published pairing of the current
// round, then completes the round. Assumes pairings auto-publish; suites that
// publish manually or record results differently keep their own variant.
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
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  for (const { match, players } of pairings) {
    if (players.length !== 2) {
      continue;
    }
    await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  }
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
}

type TournamentPhaseInputs = FunctionArgs<
  typeof api.tournaments.lifecycle.createTournamentWithPhases
>["phases"];

// Creates and publishes a phased tournament with playerCount confirmed active
// players (numbered 1..N as playerIdentity numbers), seeded directly through
// the identity hop registerSelf performs. The knobs cover the ways suites
// deliberately shape the field:
//   - tiebreak "descending" makes equal records rank in player-number order
//     (keeping e.g. the round-one bye on the highest player number);
//     "ascending" reverses that.
//   - firstPublicCode shifts the players' publicCodes when a suite must keep
//     them clear of other manually assigned codes.
//   - playerNames denormalizes registration.playerName (true = the identity
//     name; an array supplies custom names, which also become the user names).
//     Suites that omit it exercise the readers' live-user-lookup fallback.
export async function seedTournamentWithPlayers(
  t: TestConvex<typeof schema>,
  options: {
    name: string;
    playerCount: number;
    phases?: TournamentPhaseInputs;
    autoPublishPairings?: boolean;
    firstPublicCode?: number;
    tiebreak?: "ascending" | "descending";
    playerNames?: boolean | string[];
  },
) {
  const {
    name,
    playerCount,
    phases = [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    autoPublishPairings = true,
    firstPublicCode = 1,
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
      playerCapacity: 16,
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

  const customNames = Array.isArray(playerNames) ? playerNames : undefined;
  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const ids: Id<"tournamentRegistrations">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      const playerName = customNames?.[playerNumber - 1] ?? identity.name;
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: firstPublicCode + playerNumber - 1,
        email: identity.email,
        name: playerName,
        updatedAt: now,
      });
      const participantId = await insertLinkedParticipant(ctx, userId);
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          participantId,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          ...(playerNames ? { playerName } : {}),
          createdAt: now + playerNumber,
          tiebreakRandom:
            tiebreak === "descending" ? 100_000 - playerNumber : playerNumber,
          updatedAt: now,
        }),
      );
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: playerCount,
      updatedAt: now,
    });
    return ids;
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  return { tournamentId, registrationIds };
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
