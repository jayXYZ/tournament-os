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
      format: "swiss",
      isTestEvent: false,
      createdAt: now,
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

  const tournaments = await t.query(api.tournaments.listUpcomingPublic);

  expect(tournaments.map((tournament) => tournament._id)).toEqual([
    rows.earlier,
    rows.later,
  ]);
  expect(tournaments.map((tournament) => tournament.name)).toEqual([
    "Earlier Public",
    "Later Public",
  ]);
});

test("listUpcomingForOrganization returns active future tournaments for one organization", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);
  const otherOrganizationId = await t.run(async (ctx) => {
    return await ctx.db.insert("organizations", {
      workosOrganizationId: "org_other",
      name: "Other Org",
      slug: "other-org",
      createdBy: userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  const rows = await t.run(async (ctx) => {
    const base = {
      organizationId,
      createdBy: userId,
      playerCapacity: 32,
      format: "swiss",
      isTestEvent: false,
      createdAt: now,
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
    .query(api.tournaments.listUpcomingForOrganization, {
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
    .mutation(api.tournaments.createTournamentWithPhases, {
      organizationId,
      name: "Store Championship",
      startDate: now + 86_400_000,
      playerCapacity: 32,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.getTournamentSetup, { tournamentId });

  expect(setup.tournament.name).toBe("Store Championship");
  expect(setup.tournament.status).toBe("private");
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
    .mutation(api.tournaments.createTournamentWithPhases, {
      organizationId,
      name: "Practice Event",
      startDate: now + 86_400_000,
      playerCapacity: 16,
      isTestEvent: true,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.getTournamentSetup, { tournamentId });

  expect(setup.tournament.isTestEvent).toBe(true);
});

test("createTournamentWithPhases stores multiple Swiss phases in order", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.createTournamentWithPhases, {
      organizationId,
      name: "Regional Trial",
      startDate: now + 86_400_000,
      playerCapacity: 64,
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 6 },
        { phaseOrder: 2, phaseRoundMode: "dynamic" },
      ],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.getTournamentSetup, { tournamentId });

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
      api.tournaments.createTournamentWithPhases,
      {
        organizationId,
        name: "No Phase Event",
        startDate: Date.now() + 86_400_000,
        playerCapacity: 16,
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
    api.tournaments.createTournamentWithPhases,
    {
      organizationId,
      name: "Dynamic Round Event",
      startDate: Date.now(),
      playerCapacity: 16,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 5);

  await authed.mutation(api.tournaments.startTournament, { tournamentId });
  const setup = await authed.query(api.tournaments.getTournamentSetup, {
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
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      name: organizerIdentity.name,
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      workosOrganizationId: "org_test",
      name: "Test Org",
      slug: "test-org",
      createdBy: userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      workosOrganizationId: "org_test",
      userId,
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return { organizationId };
  });
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(api.tournaments.createTestTournament, {
    organizationId,
    name: "Simulation Check",
    dummyPlayerCount: 5,
    roundsToGenerate: 2,
    seed: 4242,
    autoStart: true,
  });
  const registrations = await authed.query(api.tournaments.listRegistrations, {
    tournamentId,
  });
  expect(registrations).toHaveLength(5);

  const roundOne = await authed.query(api.tournaments.getCurrentRound, {
    tournamentId,
  });
  expect(roundOne?.roundNumber).toBe(1);
  const roundOnePairings = await authed.query(api.tournaments.listRoundPairings, {
    roundId: roundOne!._id,
  });
  expect(roundOnePairings).toHaveLength(3);
  expect(
    roundOnePairings.some((pairing) =>
      pairing.players.some((player) => player.isBye),
    ),
  ).toBe(true);

  await authed.mutation(api.tournaments.advanceTestRound, { tournamentId });
  const roundOneStandings = await authed.query(api.tournaments.getStandings, {
    roundId: roundOne!._id,
  });
  expect(roundOneStandings).toHaveLength(5);

  const roundTwo = await authed.query(api.tournaments.getCurrentRound, {
    tournamentId,
  });
  expect(roundTwo?.roundNumber).toBe(2);
  await authed.mutation(api.tournaments.advanceTestRound, { tournamentId });

  const setup = await authed.query(api.tournaments.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.status).toBe("completed");
  expect(setup.testConfig?.seed).toBe(4242);

  await authed.mutation(api.tournaments.resetTestTournament, { tournamentId });
  const resetSetup = await authed.query(api.tournaments.getTournamentSetup, {
    tournamentId,
  });
  const resetRegistrations = await authed.query(
    api.tournaments.listRegistrations,
    { tournamentId },
  );
  const resetCurrentRound = await authed.query(api.tournaments.getCurrentRound, {
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
    api.tournaments.createTournament,
    {
      organizationId,
      name: "Real Event",
      startDate: Date.now(),
      playerCapacity: 8,
    },
  );

  await expect(
    authed.mutation(api.tournaments.seedTestPlayers, {
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
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      name: organizerIdentity.name,
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      workosOrganizationId: "org_test",
      name: "Test Org",
      slug: "test-org",
      createdBy: userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      workosOrganizationId: "org_test",
      userId,
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      workosUserId: organizerIdentity.subject,
      email: organizerIdentity.email,
      role: "owner",
      status: "active",
      createdAt: now,
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
        workosUserId: `player:${playerNumber}`,
        email: `player${playerNumber}@example.test`,
        name: `Player ${playerNumber}`,
        createdAt: now,
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
