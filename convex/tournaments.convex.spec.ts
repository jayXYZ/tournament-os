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

    return { organizationId };
  });
}
