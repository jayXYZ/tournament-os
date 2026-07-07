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
      publicCode: 100_001,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      activeRegistrationCount: 0,
      updatedAt: now,
    };

    await ctx.db.insert("tournaments", {
      ...base,
      name: "Past Public",
      visibility: "public",
      lifecycle: "registration",
      startDate: now - 60_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Setup",
      visibility: "public",
      lifecycle: "setup",
      startDate: now + 30_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Cancelled",
      visibility: "public",
      lifecycle: "cancelled",
      startDate: now + 45_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future In Progress",
      visibility: "public",
      lifecycle: "in_progress",
      startDate: now + 50_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Unlisted",
      visibility: "unlisted",
      lifecycle: "registration",
      startDate: now + 60_000,
    });
    const later = await ctx.db.insert("tournaments", {
      ...base,
      name: "Later Public",
      visibility: "public",
      lifecycle: "registration",
      startDate: now + 120_000,
    });
    const earlier = await ctx.db.insert("tournaments", {
      ...base,
      name: "Earlier Public",
      visibility: "public",
      lifecycle: "registration",
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
  expect(tournaments.map((tournament) => tournament.organizationName)).toEqual([
    "Test Org",
    "Test Org",
  ]);
});

test("getPublicTournament hides private and unpublished events and reports registration counts", async () => {
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
      activeRegistrationCount: 0,
      updatedAt: now,
    };

    const publicId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Open Event",
      publicCode: 100_001,
      visibility: "public",
      lifecycle: "registration",
      startDate: now + 60_000,
    });
    const privateId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Hidden Event",
      publicCode: 100_002,
      visibility: "private",
      lifecycle: "registration",
      startDate: now + 60_000,
    });
    const unlistedId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Unlisted Event",
      publicCode: 100_003,
      visibility: "unlisted",
      lifecycle: "registration",
      startDate: now + 60_000,
    });
    const setupId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Setup Event",
      publicCode: 100_004,
      visibility: "public",
      lifecycle: "setup",
      startDate: now + 60_000,
    });

    return { publicId, privateId, unlistedId, setupId };
  });
  await seedActiveRegistrations(t, rows.publicId, 3);

  const visible = await t.query(api.tournaments.lifecycle.getPublicTournament, {
    publicCode: "100001",
  });
  expect(visible?.tournament.name).toBe("Open Event");
  expect(visible?.organizationName).toBe("Test Org");
  expect(visible?.registeredCount).toBe(3);

  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "100002",
    }),
  ).toBeNull();
  // Unlisted events stay reachable by code; setup-stage events are hidden even when public.
  const unlisted = await t.query(
    api.tournaments.lifecycle.getPublicTournament,
    { publicCode: "100003" },
  );
  expect(unlisted?.tournament.name).toBe("Unlisted Event");
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "100004",
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: rows.publicId,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "not-a-real-id",
    }),
  ).toBeNull();
});

test("getPublicTournament keeps private events resolvable for registered players", async () => {
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
      publicCode: 1,
      email: playerIdentity.email,
      name: playerIdentity.name,
      updatedAt: now,
    });
    const tournamentId = await ctx.db.insert("tournaments", {
      organizationId,
      createdBy: userId,
      publicCode: 100_001,
      playerCapacity: 32,
      format: "standard",
      isTestEvent: false,
      activeRegistrationCount: 1,
      updatedAt: now,
      name: "Private Live Event",
      visibility: "private",
      lifecycle: "in_progress",
      startDate: now - 60_000,
    });
    await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId: playerUserId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  const asPlayer = await t
    .withIdentity(playerIdentity)
    .query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "100001",
    });
  expect(asPlayer?.tournament.name).toBe("Private Live Event");

  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "100001",
    }),
  ).toBeNull();
  // Organizing-team members resolve private events too: the admin Overview
  // previews the public page even before publish.
  const asOrganizer = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: "100001",
    });
  expect(asOrganizer?.tournament.name).toBe("Private Live Event");
  // Signed in without a registration or membership is still not enough.
  expect(
    await t
      .withIdentity({
        issuer: "https://convex.test",
        subject: "stranger",
        tokenIdentifier: "https://convex.test|stranger",
        email: "stranger@example.test",
        name: "Stranger",
      })
      .query(api.tournaments.lifecycle.getPublicTournament, {
        publicCode: "100001",
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
      publicCode: 1,
      email: playerIdentity.email,
      name: playerIdentity.name,
      updatedAt: now,
    });
    const base = {
      organizationId,
      createdBy: userId,
      publicCode: 100_001,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      activeRegistrationCount: 0,
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
      visibility: "public",
      lifecycle: "registration",
      startDate: now + 120_000,
    });
    const inProgress = await ctx.db.insert("tournaments", {
      ...base,
      name: "In Progress Event",
      visibility: "public",
      lifecycle: "in_progress",
      startDate: now + 60_000,
    });
    const completed = await ctx.db.insert("tournaments", {
      ...base,
      name: "Completed Event",
      visibility: "public",
      lifecycle: "completed",
      startDate: now - 60_000,
    });
    const droppedFrom = await ctx.db.insert("tournaments", {
      ...base,
      name: "Dropped Event",
      visibility: "public",
      lifecycle: "registration",
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
      publicCode: 100_001,
      playerCapacity: 32,
      format: "standard" as const,
      isTestEvent: false,
      activeRegistrationCount: 0,
      updatedAt: now,
    };

    await ctx.db.insert("tournaments", {
      ...base,
      name: "Past Setup",
      visibility: "public",
      lifecycle: "setup",
      startDate: now - 60_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Cancelled",
      visibility: "public",
      lifecycle: "cancelled",
      startDate: now + 45_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      name: "Future Completed",
      visibility: "public",
      lifecycle: "completed",
      startDate: now + 50_000,
    });
    await ctx.db.insert("tournaments", {
      ...base,
      organizationId: otherOrganizationId,
      name: "Other Organization Public",
      visibility: "public",
      lifecycle: "registration",
      startDate: now + 75_000,
    });
    const publicTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "Public Event",
      visibility: "public",
      lifecycle: "registration",
      startDate: now + 90_000,
    });
    const setupTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "Unpublished Setup",
      visibility: "public",
      lifecycle: "setup",
      startDate: now + 120_000,
    });
    const inProgressTournament = await ctx.db.insert("tournaments", {
      ...base,
      name: "In Progress Event",
      visibility: "public",
      lifecycle: "in_progress",
      startDate: now + 150_000,
    });

    return { publicTournament, setupTournament, inProgressTournament };
  });

  const tournaments = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.listUpcomingForOrganization, {
      organizationId,
    });

  expect(tournaments.map((tournament) => tournament._id)).toEqual([
    rows.publicTournament,
    rows.setupTournament,
    rows.inProgressTournament,
  ]);
  expect(tournaments.map((tournament) => tournament.name)).toEqual([
    "Public Event",
    "Unpublished Setup",
    "In Progress Event",
  ]);
});

test("createTournamentWithPhases creates an unpublished public tournament with one dynamic Swiss phase", async () => {
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
  expect(setup.tournament.publicCode).toBe(100_001);
  expect(setup.tournament.visibility).toBe("public");
  expect(setup.tournament.lifecycle).toBe("setup");
  expect(setup.tournament.format).toBe("modern");
  expect(setup.phases).toHaveLength(1);
  expect(setup.phases[0].phaseType).toBe("swiss");
  expect(setup.phases[0].phaseOrder).toBe(1);
  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBeNull();
});

test("tournament creation assigns sequential public codes", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const firstTournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "First Public Code",
      startDate: now + 86_400_000,
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  const secondTournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Second Public Code",
      startDate: now + 172_800_000,
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  const testTournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Test Public Code",
      dummyPlayerCount: 4,
    },
  );

  const [first, second, testTournament] = await Promise.all([
    authed.query(api.tournaments.lifecycle.getTournamentSetup, {
      tournamentId: firstTournamentId,
    }),
    authed.query(api.tournaments.lifecycle.getTournamentSetup, {
      tournamentId: secondTournamentId,
    }),
    authed.query(api.tournaments.lifecycle.getTournamentSetup, {
      tournamentId: testTournamentId,
    }),
  ]);

  expect(first.tournament.publicCode).toBe(100_001);
  expect(second.tournament.publicCode).toBe(100_002);
  expect(testTournament.tournament.publicCode).toBe(100_003);
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

test("seedTestPlayers fills only remaining active registration seats", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Mixed Test Field",
      startDate: now + 86_400_000,
      playerCapacity: 32,
      format: "standard",
      isTestEvent: true,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "player:real",
      publicCode: 1,
      email: "player@example.test",
      name: "Real Player",
      updatedAt: now,
    });
    await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  const firstSeed = await authed.mutation(api.tournaments.testing.seedTestPlayers, {
    tournamentId,
    count: 32,
  });
  expect(firstSeed.addedCount).toBe(31);

  const registrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  expect(registrations).toHaveLength(32);

  const secondSeed = await authed.mutation(api.tournaments.testing.seedTestPlayers, {
    tournamentId,
    count: 32,
  });
  expect(secondSeed.addedCount).toBe(0);

  const afterSecondSeed = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  expect(afterSecondSeed).toHaveLength(32);

  const testPlayerCount = await t.run(async (ctx) => {
    return (
      await ctx.db
        .query("testTournamentPlayers")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .collect()
    ).length;
  });
  expect(testPlayerCount).toBe(31);
});

test("seedTestPlayers count is seats to add, not a target total", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Incremental Seeding",
      startDate: now + 86_400_000,
      playerCapacity: 32,
      format: "standard",
      isTestEvent: true,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "player:real",
      publicCode: 1,
      email: "player@example.test",
      name: "Real Player",
      updatedAt: now,
    });
    await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  // With one seat already taken, asking for 5 must add exactly 5 (seats to
  // add). The old "target total" semantics would have added only 4 here.
  const firstSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 5 },
  );
  expect(firstSeed.addedCount).toBe(5);
  expect(
    await authed.query(api.tournaments.registrations.listRegistrations, {
      tournamentId,
    }),
  ).toHaveLength(6);

  // A count of 1 must not throw (the old code routed count through
  // validCapacity, which rejected anything below 2) and adds exactly one.
  const secondSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 1 },
  );
  expect(secondSeed.addedCount).toBe(1);
  expect(
    await authed.query(api.tournaments.registrations.listRegistrations, {
      tournamentId,
    }),
  ).toHaveLength(7);

  // Requesting more than the remaining capacity is clamped to what fits.
  const thirdSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 100 },
  );
  expect(thirdSeed.addedCount).toBe(25);
  expect(
    await authed.query(api.tournaments.registrations.listRegistrations, {
      tournamentId,
    }),
  ).toHaveLength(32);
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

test("multi-phase tournaments advance into the next phase and carry records", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Two Phase Event",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 },
        { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 4);
  await authed.mutation(api.tournaments.rounds.startTournament, { tournamentId });

  // Phase 1: two rounds.
  const roundOne = await playOutCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, { tournamentId });
  const roundTwo = await playOutCurrentRound(authed, tournamentId);

  // Phase 1 is finished, but a phase remains: the next step is another round,
  // not tournament completion.
  let board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "generateNextRound",
    ready: true,
  });

  // Completing the tournament between phases would strand phase 2 forever,
  // so the mutation must refuse even though phase 1's final round is done.
  await expect(
    authed.mutation(api.tournaments.lifecycle.completeTournament, {
      tournamentId,
    }),
  ).rejects.toThrow(/next phase has not been played/);

  await authed.mutation(api.tournaments.rounds.generateNextRound, { tournamentId });
  board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.phases.map(({ phase }) => phase.phaseStatus)).toEqual([
    "completed",
    "in_progress",
  ]);
  // Round numbering is global: after two phase-1 rounds, phase 2 opens with
  // round 3, not round 1.
  const phaseTwoRound = await authed.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  expect(phaseTwoRound?.roundNumber).toBe(3);
  expect(phaseTwoRound?.roundName).toBe("Round 3");
  expect(phaseTwoRound?.tournamentPhaseId).toBe(board.phases[1].phase._id);

  const roundThree = await playOutCurrentRound(authed, tournamentId);

  // Pairing history carries across the boundary: with four players over three
  // rounds, rematch avoidance forces all six distinct pairings.
  const allPairs = [
    ...roundOne.pairKeys,
    ...roundTwo.pairKeys,
    ...roundThree.pairKeys,
  ];
  expect(new Set(allPairs).size).toBe(6);

  // Records carry too: after the phase-2 round every player has three rounds
  // of results.
  const standings = await authed.query(api.tournaments.rounds.getStandings, {
    roundId: roundThree.round._id,
  });
  expect(standings).toHaveLength(4);
  for (const standing of standings) {
    expect(
      standing.matchWins + standing.matchLosses + standing.matchDraws,
    ).toBe(3);
  }

  board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "completeTournament",
    ready: true,
  });
  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.tournament.lifecycle).toBe("completed");
  expect(board.nextStep).toEqual({ kind: "tournamentCompleted" });
});

test("test tournaments seed players, generate Swiss rounds, and complete", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      publicCode: 1,
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
  expect(setup.tournament.lifecycle).toBe("completed");
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
  expect(resetSetup.tournament.lifecycle).toBe("setup");
  expect(resetSetup.testConfig?.seed).toBe(4242);
  expect(resetRegistrations).toHaveLength(5);
  expect(resetCurrentRound).toBeNull();
});

test("test round simulation generates varied results after an existing report", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Simulation Variety Check",
      dummyPlayerCount: 32,
      roundsToGenerate: 1,
      seed: 971,
      autoStart: true,
    },
  );
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const initialPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
  );
  const firstMatch = initialPairings.find(
    (pairing) => pairing.players.length === 2,
  );
  if (!firstMatch) {
    throw new Error("Expected a two-player match");
  }

  await authed.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: firstMatch.match._id,
    playerOneRegistrationId: firstMatch.players[0].playerId,
    playerTwoRegistrationId: firstMatch.players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });
  await authed.mutation(api.tournaments.testing.generateTestRoundResults, {
    tournamentId,
  });

  const resolvedPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
  );
  const simulatedMatches = resolvedPairings.filter(
    (pairing) => pairing.match._id !== firstMatch.match._id,
  );
  const simulatedOutcomes = simulatedMatches.map((pairing) =>
    pairing.players
      .map((player) => `${player.gameWins ?? 0}-${player.gameLosses ?? 0}`)
      .join("|"),
  );

  expect(simulatedOutcomes).toHaveLength(15);

  // Regression guard: the old implementation seeded a fresh PRNG per match
  // from `seed + roundNumber * 1000 + tableNumber`. Adjacent tables differ by
  // one in the seed, so their first PRNG outputs were nearly identical and
  // almost every match collapsed into the same result branch (same winner
  // direction). A per-round PRNG drawn sequentially must instead produce a
  // genuine spread of outcomes, including wins for both seats.
  const playerOneWins = simulatedMatches.filter(
    (pairing) =>
      (pairing.players[0].gameWins ?? 0) > (pairing.players[1].gameWins ?? 0),
  ).length;
  const playerTwoWins = simulatedMatches.filter(
    (pairing) =>
      (pairing.players[1].gameWins ?? 0) > (pairing.players[0].gameWins ?? 0),
  ).length;
  expect(playerOneWins).toBeGreaterThan(0);
  expect(playerTwoWins).toBeGreaterThan(0);
  expect(new Set(simulatedOutcomes).size).toBeGreaterThanOrEqual(3);
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
      publicCode: 1,
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

// Records a 2-0 win for the listed player one in every non-bye match of the
// current round, then completes the round. Returns the round and the unordered
// registration-id pair of each match for rematch assertions.
async function playOutCurrentRound(
  authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  tournamentId: Id<"tournaments">,
) {
  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round to play out");
  }
  const pairings = await authed.query(api.tournaments.rounds.listRoundPairings, {
    roundId: round._id,
  });
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
    await authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  }
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
  return { round, pairKeys };
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
        publicCode: playerNumber,
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
    const tournament = await ctx.db.get(tournamentId);
    if (tournament) {
      await ctx.db.patch(tournamentId, {
        activeRegistrationCount: tournament.activeRegistrationCount + count,
      });
    }
  });
}
