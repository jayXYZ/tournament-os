/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const organizerIdentity = {
  issuer: "https://convex.test",
  subject: "organizer",
  tokenIdentifier: "https://convex.test|organizer",
  email: "organizer@example.test",
  name: "Organizer",
};

test("listUpcomingPublic returns future public tournaments in start date order", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);

  const rows = await t.run(async (ctx) => {
    const base = {
      organizationId,
      createdBy: userId,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      updatedAt: now,
    };

    await ctx.db.insert("tournaments", {
      ...base,
      name: "Past Public",
      status: "public",
      startDate: now - 60_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Private",
      status: "private",
      startDate: now + 30_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Cancelled",
      status: "cancelled",
      startDate: now + 45_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future In Progress",
      status: "in_progress",
      startDate: now + 50_000,
    });
    const later = await ctx.db.insert("tournaments", {
      ...base,
      name: "Later Public",
      status: "public",
      startDate: now + 120_000,
    });
    const earlier = await ctx.db.insert("tournaments", {
      ...base,
      name: "Earlier Public",
      status: "public",
      startDate: now + 90_000,
    });

    return { earlier, later };
  });

  const tournaments = await t.query(api.tournaments.lifecycle.listUpcomingPublic);

  expect(tournaments.map((tournament) => tournament._id)).toEqual([
    rows.earlier,
    rows.later,
  ]);
  expect(tournaments.map((tournament) => tournament.name)).toEqual([
    "Earlier Public",
    "Later Public",
  ]);
});

test("getPublicTournament hides private events and reports registration counts", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);

  const rows = await t.run(async (ctx) => {
    const base = {
      organizationId,
      createdBy: userId,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      updatedAt: now,
    };

    const publicId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Open Event",
      status: "public",
      startDate: now + 60_000,
    });
    const privateId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Hidden Event",
      status: "private",
      startDate: now + 60_000,
    });

    return { publicId, privateId };
  });
  await seedActiveRegistrations(t, rows.publicId, 3);

  const visible = await t.query(api.tournaments.lifecycle.getPublicTournament, {
    tournamentId: rows.publicId,
  });
  expect(visible?.tournament.name).toBe("Open Event");
  expect(visible?.organizationName).toBe("Test Org");
  expect(visible?.registeredCount).toBe(3);

  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      tournamentId: rows.privateId,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      tournamentId: "not-a-real-id",
    }),
  ).toBeNull();
});

test("listMyTournaments returns the player's active registrations for visible events", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);
  const playerIdentity = {
    issuer: "https://convex.test",
    subject: "player",
    tokenIdentifier: "https://convex.test|player",
    email: "player@example.test",
    name: "Player",
  };

  await t.run(async (ctx) => {
    const playerUserId = await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity.tokenIdentifier,
      email: playerIdentity.email,
      name: playerIdentity.name,
      updatedAt: now,
    });
    const base = {
      organizationId,
      createdBy: userId,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      updatedAt: now,
    };
    const registrationBase = {
      userId: playerUserId,
      createdAt: now,
      updatedAt: now,
    };

    const laterPublic = await ctx.db.insert("tournaments", {
      ...base,
      name: "Later Public Event",
      status: "public",
      startDate: now + 120_000,
    });
    const inProgress = await ctx.db.insert("tournaments", {
      ...base,
      name: "In Progress Event",
      status: "in_progress",
      startDate: now + 60_000,
    });
    const completed = await ctx.db.insert("tournaments", {
      ...base,
      name: "Completed Event",
      status: "completed",
      startDate: now - 60_000,
    });
    const droppedFrom = await ctx.db.insert("tournaments", {
      ...base,
      name: "Dropped Event",
      status: "public",
      startDate: now + 90_000,
    });

    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: laterPublic,
      status: "active",
    });
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: inProgress,
      status: "active",
    });
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: completed,
      status: "active",
    });
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: droppedFrom,
      status: "dropped",
    });
  });

  const rows = await t
    .withIdentity(playerIdentity)
    .query(api.tournaments.registrations.listMyTournaments, {});

  expect(rows.map((row) => row.tournament.name)).toEqual([
    "In Progress Event",
    "Later Public Event",
  ]);
  expect(rows[0].organizationName).toBe("Test Org");

  const anonymous = await t.query(
    api.tournaments.registrations.listMyTournaments,
    {},
  );
  expect(anonymous).toEqual([]);
});

test("listUpcomingForOrganization returns active future tournaments for one organization", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);
  const otherOrganizationId = await t.run(async (ctx) => {
    return await ctx.db.insert("organizations", {
      name: "Other Org",
      slug: "other-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
  });

  const rows = await t.run(async (ctx) => {
    const base = {
      organizationId,
      createdBy: userId,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      updatedAt: now,
    };

    await ctx.db.insert("tournaments", {
      ...base,
      name: "Past Private",
      status: "private",
      startDate: now - 60_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Cancelled",
      status: "cancelled",
      startDate: now + 45_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Completed",
      status: "completed",
      startDate: now + 50_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      organizationId: otherOrganizationId,
      name: "Other Organization Public",
      status: "public",
      startDate: now + 75_000,
    });
    const publicTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "Public Event",
      status: "public",
      startDate: now + 90_000,
    });
    const privateTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "Private Setup",
      status: "private",
      startDate: now + 120_000,
    });
    const inProgressTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "In Progress Event",
      status: "in_progress",
      startDate: now + 150_000,
    });

    return { publicTournament, privateTournament, inProgressTournament };
  });

  const tournaments = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.listUpcomingForOrganization, {
      organizationId,
    });

  expect(tournaments.map((tournament) => tournament._id)).toEqual([
    rows.publicTournament,
    rows.privateTournament,
    rows.inProgressTournament,
  ]);
  expect(tournaments.map((tournament) => tournament.name)).toEqual([
    "Public Event",
    "Private Setup",
    "In Progress Event",
  ]);
});

test("createTournamentWithPhases creates a private tournament with one dynamic Swiss phase", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Store Championship",
      startDate: now + 86_400_000,
      playerCapacity: 32,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.getTournamentSetup, { tournamentId });

  expect(setup.tournament.name).toBe("Store Championship");
  expect(setup.tournament.status).toBe("private");
  expect(setup.tournament.format).toBe("modern");
  expect(setup.phases).toHaveLength(1);
  expect(setup.phases[0].phaseType).toBe("swiss");
  expect(setup.phases[0].phaseOrder).toBe(1);
  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBeNull();
});

test("createTournamentWithPhases can mark a tournament as a test event", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Practice Event",
      startDate: now + 86_400_000,
      playerCapacity: 16,
      format: "draft",
      isTestEvent: true,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.getTournamentSetup, { tournamentId });

  expect(setup.tournament.isTestEvent).toBe(true);
});

test("createTournamentWithPhases stores multiple Swiss phases in order", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Regional Trial",
      startDate: now + 86_400_000,
      playerCapacity: 64,
      format: "standard",
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 6 },
        { phaseOrder: 2, phaseRoundMode: "dynamic" },
      ],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.getTournamentSetup, { tournamentId });

  expect(setup.phases.map((phase) => phase.phaseOrder)).toEqual([1, 2]);
  expect(setup.phases.map((phase) => phase.phaseRoundMode)).toEqual([
    "fixed",
    "dynamic",
  ]);
  expect(setup.phases.map((phase) => phase.phaseTotalRounds)).toEqual([6, null]);
});

test("createTournamentWithPhases rejects an empty phase list", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);

  await expect(
    t.withIdentity(organizerIdentity).mutation(
      api.tournaments.lifecycle.createTournamentWithPhases,
      {
        organizationId,
        name: "No Phase Event",
        startDate: Date.now() + 86_400_000,
        playerCapacity: 16,
        format: "standard",
        phases: [],
      },
    ),
  ).rejects.toThrow("At least one Swiss phase is required");
});

test("startTournament resolves dynamic Swiss rounds from active player count", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Dynamic Round Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 5);

  await authed.mutation(api.tournaments.rounds.startTournament, { tournamentId });
  const setup = await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });

  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBe(3);
});

test("test tournaments seed players, generate Swiss rounds, and complete", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
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

    return { organizationId };
  });
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(api.tournaments.testing.createTestTournament, {
    organizationId,
    name: "Simulation Check",
    dummyPlayerCount: 5,
    roundsToGenerate: 2,
    seed: 4242,
    autoStart: true,
  });
  const registrations = await authed.query(api.tournaments.registrations.listRegistrations, {
    tournamentId,
  });
  expect(registrations).toHaveLength(5);

  const roundOne = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(roundOne?.roundNumber).toBe(1);
  const roundOnePairings = await authed.query(api.tournaments.rounds.listRoundPairings, {
    roundId: roundOne!._id,
  });
  expect(roundOnePairings).toHaveLength(3);
  expect(
    roundOnePairings.some((pairing) =>
      pairing.players.some((player) => player.isBye),
    ),
  ).toBe(true);

  await authed.mutation(api.tournaments.testing.advanceTestRound, { tournamentId });
  const roundOneStandings = await authed.query(api.tournaments.rounds.getStandings, {
    roundId: roundOne!._id,
  });
  expect(roundOneStandings).toHaveLength(5);

  const roundTwo = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(roundTwo?.roundNumber).toBe(2);
  await authed.mutation(api.tournaments.testing.advanceTestRound, { tournamentId });

  const setup = await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.status).toBe("completed");
  expect(setup.testConfig?.seed).toBe(4242);

  await authed.mutation(api.tournaments.testing.resetTestTournament, { tournamentId });
  const resetSetup = await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  const resetRegistrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  const resetCurrentRound = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(resetSetup.tournament.status).toBe("private");
  expect(resetSetup.testConfig?.seed).toBe(4242);
  expect(resetRegistrations).toHaveLength(5);
  expect(resetCurrentRound).toBeNull();
});

test("test simulation functions reject non-test tournaments", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await authed.mutation(
    api.tournaments.lifecycle.createTournament,
    {
      organizationId,
      name: "Real Event",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
    },
  );

  await expect(
    authed.mutation(api.tournaments.testing.seedTestPlayers, {
      tournamentId,
      count: 4,
    }),
  ).rejects.toThrow("Tournament is not a test event");
});

async function seedOrganizer(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
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

async function seedActiveRegistrations(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  count: number,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let playerNumber = 1; playerNumber <= count; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `player:${playerNumber}`,
        email: `player${playerNumber}@example.test`,
        name: `Player ${playerNumber}`,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        status: "active",
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
  });
}
