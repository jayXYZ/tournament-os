/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateTestResults } from "./model/testing";
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
      autoPublishPairings: false,
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

  const tournaments = await t.query(
    api.tournaments.lifecycle.listUpcomingPublic,
  );

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
      autoPublishPairings: false,
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
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", "player:1"),
      )
      .unique();
    if (!user) {
      throw new Error("Expected seeded player");
    }
    const now = Date.now();
    await ctx.db.insert("tournamentRegistrations", {
      tournamentId: rows.setupId,
      userId: user._id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(rows.setupId, { activeRegistrationCount: 1 });
  });

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
  const registeredSetupPlayer = {
    issuer: "https://convex.test",
    subject: "setup-player",
    tokenIdentifier: "player:1",
    email: "player1@example.test",
    name: "Player 1",
  };
  expect(
    await t
      .withIdentity(registeredSetupPlayer)
      .query(api.tournaments.lifecycle.getPublicTournament, {
        publicCode: "100004",
      }),
  ).toBeNull();
  expect(
    (
      await t
        .withIdentity(organizerIdentity)
        .query(api.tournaments.lifecycle.getPublicTournament, {
          publicCode: "100004",
        })
    )?.tournament.lifecycle,
  ).toBe("setup");
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
      autoPublishPairings: false,
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
      autoPublishPairings: false,
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
      autoPublishPairings: false,
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

  const organizer = t.withIdentity(organizerIdentity);
  expect(
    await organizer.query(api.tournaments.rounds.getPairingsBoard, {
      tournamentId,
    }),
  ).toMatchObject({
    nextStep: { kind: "publishTournament", ready: true },
  });
  await expect(
    organizer.mutation(api.tournaments.rounds.startTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("Tournament must be published before it can start");

  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    name: "Published and still editable",
  });
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: setup.phases[0]._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 5,
      },
    ],
  });
  const registrationSetup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(registrationSetup.tournament.name).toBe(
    "Published and still editable",
  );
  expect(registrationSetup.phases[0].phaseTotalRounds).toBe(5);
});

test("unlisted registration events are direct-link accessible but absent from discovery", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Direct Link Event",
      startDate: Date.now() + 86_400_000,
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
    {
      tournamentId,
      visibility: "unlisted",
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  const publicCode = String(setup.tournament.publicCode);

  expect(
    (
      await t.query(api.tournaments.lifecycle.getPublicTournament, {
        publicCode,
      })
    )?.tournament.visibility,
  ).toBe("unlisted");
  expect(
    (await t.query(api.tournaments.lifecycle.listUpcomingPublic)).some(
      (tournament) => tournament._id === tournamentId,
    ),
  ).toBe(false);

  const player = t.withIdentity({
    issuer: "https://convex.test",
    subject: "unlisted-player",
    tokenIdentifier: "https://convex.test|unlisted-player",
    email: "unlisted@example.test",
    name: "Unlisted Player",
  });
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).resolves.toBeDefined();
});

test("updateTournamentDetails stores trimmed markdown and clears it when emptied", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Detailed Event",
      startDate: now + 86_400_000,
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  await authed.mutation(api.tournaments.lifecycle.updateTournamentDetails, {
    tournamentId,
    detailsMarkdown: "## Prizes\n\n- 1st: booster box\n",
  });

  const withDetails = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(withDetails.tournament.detailsMarkdown).toBe(
    "## Prizes\n\n- 1st: booster box",
  );

  // Details stay editable after the tournament starts, unlike core setup.
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.lifecycle.updateTournamentDetails, {
    tournamentId,
    detailsMarkdown: "Updated during registration",
  });

  await authed.mutation(api.tournaments.lifecycle.updateTournamentDetails, {
    tournamentId,
    detailsMarkdown: "   \n\n  ",
  });
  const cleared = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(cleared.tournament.detailsMarkdown).toBeUndefined();

  await expect(
    t.mutation(api.tournaments.lifecycle.updateTournamentDetails, {
      tournamentId,
      detailsMarkdown: "anonymous edit",
    }),
  ).rejects.toThrow();

  // Cancelled events are read-only, even for organizers.
  await authed.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  await expect(
    authed.mutation(api.tournaments.lifecycle.updateTournamentDetails, {
      tournamentId,
      detailsMarkdown: "edit after cancellation",
    }),
  ).rejects.toThrow("Tournament has been cancelled");
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

  const firstSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    {
      tournamentId,
      count: 32,
    },
  );
  expect(firstSeed.addedCount).toBe(31);

  const registrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  expect(registrations).toHaveLength(32);

  const secondSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    {
      tournamentId,
      count: 32,
    },
  );
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
  expect(setup.phases.map((phase) => phase.phaseTotalRounds)).toEqual([
    6,
    null,
  ]);
});

test("updateTournamentPhases atomically adds, removes, reorders, and changes phase types", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Editable Structure",
      startDate: Date.now() + 86_400_000,
      playerCapacity: 32,
      format: "standard",
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 4 },
        { phaseOrder: 2, phaseRoundMode: "dynamic" },
      ],
    },
  );
  const initial = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  const [phaseOne, phaseTwo] = initial.phases;
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  const reorderedIds = await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentPhases,
    {
      tournamentId,
      phases: [
        {
          phaseId: phaseTwo._id,
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 5,
        },
        {
          phaseId: phaseOne._id,
          phaseOrder: 2,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
        },
        {
          phaseOrder: 3,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  expect(reorderedIds.slice(0, 2)).toEqual([phaseTwo._id, phaseOne._id]);

  let updated = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(updated.phases.map((phase) => phase._id)).toEqual(reorderedIds);
  expect(updated.phases.map((phase) => phase.phaseName)).toEqual([
    "Phase 1",
    "Phase 2",
    "Phase 3",
  ]);
  expect(updated.phases.map((phase) => phase.phaseType)).toEqual([
    "swiss",
    "swiss",
    "single_elimination",
  ]);

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: phaseTwo._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 5,
      },
      {
        phaseId: reorderedIds[2],
        phaseOrder: 2,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
      },
    ],
  });
  updated = await organizer.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(updated.phases.map((phase) => phase._id)).toEqual([
    phaseTwo._id,
    reorderedIds[2],
  ]);
  expect(updated.phases.map((phase) => phase.phaseType)).toEqual([
    "swiss",
    "swiss",
  ]);
  expect(await t.run(async (ctx) => await ctx.db.get(phaseOne._id))).toBeNull();
});

test("pre-start settings enforce roster capacity and lock only while play is active or ended", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Lifecycle Editing",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 3);
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    playerCapacity: 4,
    format: "modern",
  });
  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      playerCapacity: 2,
    }),
  ).rejects.toThrow(
    "Player capacity cannot be lower than the active registration count",
  );
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: setup.phases[0]._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 3,
      },
    ],
  });

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  expect(
    (
      await organizer.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).phases[0].phaseTotalRounds,
  ).toBe(3);
  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      name: "Locked during play",
    }),
  ).rejects.toThrow("Tournament setup is locked after play begins");
  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
      tournamentId,
      phases: [
        {
          phaseId: setup.phases[0]._id,
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
        },
      ],
    }),
  ).rejects.toThrow("Tournament setup is locked after play begins");

  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    name: "Editable after rewind",
  });

  for (const lifecycle of ["completed", "cancelled"] as const) {
    await t.run(async (ctx) => {
      await ctx.db.patch(tournamentId, { lifecycle });
    });
    await expect(
      organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
        tournamentId,
        name: "Still locked",
      }),
    ).rejects.toThrow("Tournament setup is locked after play begins");
  }
});

test("updateTournamentPhases rejects duplicate and foreign phase IDs", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentIds = await Promise.all(
    ["First Event", "Second Event"].map((name) =>
      organizer.mutation(
        api.tournaments.lifecycle.createTournamentWithPhases,
        {
          organizationId,
          name,
          startDate: Date.now(),
          playerCapacity: 8,
          format: "standard",
          phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
        },
      ),
    ),
  );
  const [first, second] = await Promise.all(
    tournamentIds.map((tournamentId) =>
      organizer.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      }),
    ),
  );

  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
      tournamentId: tournamentIds[0],
      phases: [
        {
          phaseId: first.phases[0]._id,
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
        },
        {
          phaseId: first.phases[0]._id,
          phaseOrder: 2,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
        },
      ],
    }),
  ).rejects.toThrow("Tournament phase IDs must be unique");

  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
      tournamentId: tournamentIds[0],
      phases: [
        {
          phaseId: second.phases[0]._id,
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "dynamic",
        },
      ],
    }),
  ).rejects.toThrow("Tournament phase does not belong to this tournament");
});

test("structural phase changes reset only affected player meeting snapshots", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Meeting Reset",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseRoundMode: "dynamic",
          playerMeeting: true,
        },
        { phaseOrder: 2, phaseRoundMode: "dynamic" },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 2);
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const initial = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  const [meetingPhase, otherPhase] = initial.phases;
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: meetingPhase._id,
  });

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: meetingPhase._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 4,
        playerMeeting: true,
      },
      {
        phaseId: otherPhase._id,
        phaseOrder: 2,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
      },
    ],
  });
  let meetingState = await t.run(async (ctx) => ({
    phase: await ctx.db.get(meetingPhase._id),
    seats: await ctx.db
      .query("playerMeetingSeats")
      .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
        q.eq("tournamentPhaseId", meetingPhase._id),
      )
      .take(8),
  }));
  expect(meetingState.phase?.playerMeetingStatus).toBe("in_progress");
  expect(meetingState.seats).toHaveLength(2);

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: otherPhase._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
      },
      {
        phaseId: meetingPhase._id,
        phaseOrder: 2,
        phaseType: "swiss",
        phaseRoundMode: "fixed",
        phaseTotalRounds: 4,
        playerMeeting: true,
      },
    ],
  });
  meetingState = await t.run(async (ctx) => ({
    phase: await ctx.db.get(meetingPhase._id),
    seats: await ctx.db
      .query("playerMeetingSeats")
      .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
        q.eq("tournamentPhaseId", meetingPhase._id),
      )
      .take(8),
  }));
  expect(meetingState.phase?.playerMeetingStatus).toBeUndefined();
  expect(meetingState.seats).toHaveLength(0);
});

test("createTournamentWithPhases rejects an empty phase list", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);

  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
        organizationId,
        name: "No Phase Event",
        startDate: Date.now() + 86_400_000,
        playerCapacity: 16,
        format: "standard",
        phases: [],
      }),
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
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );

  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBe(3);
});

test("completeRound only accepts the current in-progress round", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Round Completion Guard",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 4);
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const firstRoundId = await organizer.mutation(
    api.tournaments.rounds.startTournament,
    { tournamentId },
  );
  const firstRoundPairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: firstRoundId },
  );
  await recordFirstPlayerWins(organizer, firstRoundPairings);
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: firstRoundId,
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.completeRound, {
      roundId: firstRoundId,
    }),
  ).rejects.toThrow("Current round is not in progress");

  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await expect(
    organizer.mutation(api.tournaments.rounds.completeRound, {
      roundId: firstRoundId,
    }),
  ).rejects.toThrow("Only the current round can be completed");
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
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  // Phase 1: two rounds.
  const roundOne = await playOutCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
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

  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
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
  const standings = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: roundThree.round._id,
    })
  ).map(({ standing }) => standing);
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

test("rewinding round one ignores byes, clears the timer, and reopens registration", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Round One Rewind",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 3);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const roundId = await authed.mutation(
    api.tournaments.rounds.startTournament,
    { tournamentId },
  );
  await authed.mutation(api.tournaments.rounds.publishPairings, { roundId });
  await authed.mutation(api.tournaments.timer.startTimer, { tournamentId });

  const board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.rewind).toMatchObject({
    eligible: true,
    removedRoundNumber: 1,
    reopenedRoundNumber: null,
  });
  expect(
    (
      await authed.query(api.tournaments.rounds.listRoundPairings, { roundId })
    ).some(({ players }) => players.every((player) => player.isBye)),
  ).toBe(true);

  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const after = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(after.tournament.lifecycle).toBe("registration");
  expect(after.tournament.roundTimer).toBeUndefined();
  expect(after.phases[0].phaseStatus).toBe("upcoming");
  expect(after.phases[0].phaseCurrentRound).toBeUndefined();
  await t.run(async (ctx) => {
    expect(await ctx.db.get(roundId)).toBeNull();
  });
});

test("rewind requires organizer access and an in-progress lifecycle", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Rewind Guard",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );

  for (const lifecycle of [
    "setup",
    "registration",
    "cancelled",
    "completed",
  ] as const) {
    await t.run(async (ctx) => {
      await ctx.db.patch(tournamentId, { lifecycle });
    });
    await expect(
      authed.mutation(api.tournaments.rounds.rewindLatestRound, {
        tournamentId,
      }),
    ).rejects.toThrow("Only an in-progress tournament can be rewound");
  }

  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, { lifecycle: "in_progress" });
  });
  await expect(
    t.mutation(api.tournaments.rounds.rewindLatestRound, { tournamentId }),
  ).rejects.toThrow();
});

test("rewinding a Swiss round reopens results and regenerates pairings", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Swiss Repair",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 4);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const first = await playOutCurrentRound(authed, tournamentId);
  const removedRoundId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );

  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  expect(
    await authed.query(api.tournaments.rounds.getCurrentRound, {
      tournamentId,
    }),
  ).toMatchObject({ _id: first.round._id, roundStatus: "in_progress" });
  expect(
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: first.round._id,
    }),
  ).toEqual([]);
  const reopenedPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: first.round._id },
  );
  await authed.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: reopenedPairings[0].match._id,
    playerOneRegistrationId: reopenedPairings[0].players[0].playerId,
    playerTwoRegistrationId: reopenedPairings[0].players[1].playerId,
    playerOneGameWins: 0,
    playerTwoGameWins: 2,
  });
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: first.round._id,
  });
  const replacementRoundId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  expect(replacementRoundId).not.toBe(removedRoundId);
  const replacementPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: replacementRoundId },
  );
  await authed.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: replacementPairings[0].match._id,
    playerOneRegistrationId: replacementPairings[0].players[0].playerId,
    playerTwoRegistrationId: replacementPairings[0].players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });
  expect(
    (
      await authed.query(api.tournaments.rounds.getPairingsBoard, {
        tournamentId,
      })
    ).rewind,
  ).toMatchObject({ eligible: false });
  await expect(
    authed.mutation(api.tournaments.rounds.rewindLatestRound, {
      tournamentId,
    }),
  ).rejects.toThrow(/after a match result/);

  await t.run(async (ctx) => {
    expect(await ctx.db.get(removedRoundId)).toBeNull();
    const rewound = await ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .order("desc")
      .take(8);
    expect(rewound.some(({ event }) => event.type === "round_rewound")).toBe(
      true,
    );
  });
});

test("rewinding a playoff restores cut players and reopens the Swiss phase", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Playoff Cut Repair",
      startDate: Date.now(),
      playerCapacity: 12,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 10);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const swiss = await playOutCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const cutRegistrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  const withdrawnCutPlayer = cutRegistrations.find(
    ({ registration }) => registration.status === "eliminated",
  );
  if (!withdrawnCutPlayer) {
    throw new Error("Expected a player below the playoff cut");
  }
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnCutPlayer.registration._id,
  });
  expect(
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament.activeRegistrationCount,
  ).toBe(8);

  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.activeRegistrationCount).toBe(9);
  const registrationsAfterRewind = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  expect(
    registrationsAfterRewind.find(
      ({ registration }) =>
        registration._id === withdrawnCutPlayer.registration._id,
    )?.registration.status,
  ).toBe("dropped");
  expect(setup.phases.map((phase) => phase.phaseStatus)).toEqual([
    "in_progress",
    "upcoming",
  ]);
  expect(
    await authed.query(api.tournaments.rounds.getCurrentRound, {
      tournamentId,
    }),
  ).toMatchObject({ _id: swiss.round._id, roundStatus: "in_progress" });
});

test("rewinding elimination pairings restores losers and repairs advancement", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Bracket Repair",
      startDate: Date.now(),
      playerCapacity: 12,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 12);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const swiss = await playOutCurrentRound(authed, tournamentId);
  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const registrationsAfterCut = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  const cutPlayerIds = registrationsAfterCut
    .filter(({ registration }) => registration.status === "eliminated")
    .map(({ registration }) => registration._id);
  expect(cutPlayerIds).toHaveLength(4);
  expect(
    registrationsAfterCut
      .filter(({ registration }) => cutPlayerIds.includes(registration._id))
      .map(({ registration }) => registration.eliminatedByRoundId),
  ).toEqual(Array(4).fill(swiss.round._id));
  const quarterfinalPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  await recordFirstPlayerWins(authed, quarterfinalPairings);
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  const removedSemifinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );

  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  expect(
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament.activeRegistrationCount,
  ).toBe(8);
  const registrationsAfterRewind = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  expect(
    registrationsAfterRewind
      .filter(({ registration }) => cutPlayerIds.includes(registration._id))
      .map(({ registration }) => registration.status),
  ).toEqual(Array(4).fill("eliminated"));
  expect(
    await authed.query(api.tournaments.rounds.getCurrentRound, {
      tournamentId,
    }),
  ).toMatchObject({ _id: quarterfinalId, roundStatus: "in_progress" });

  const corrected = quarterfinalPairings[0];
  const correctedWinner = corrected.players[1].playerId;
  const replacedWinner = corrected.players[0].playerId;
  await authed.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: corrected.match._id,
    playerOneRegistrationId: replacedWinner,
    playerTwoRegistrationId: correctedWinner,
    playerOneGameWins: 0,
    playerTwoGameWins: 2,
  });
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  expect(
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament.activeRegistrationCount,
  ).toBe(4);
  const repairedSemifinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const repairedSemifinals = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: repairedSemifinalId },
  );
  const repairedPlayers = repairedSemifinals.flatMap(({ players }) =>
    players.map(({ playerId }) => playerId),
  );
  expect(repairedSemifinalId).not.toBe(removedSemifinalId);
  expect(repairedPlayers).toContain(correctedWinner);
  expect(repairedPlayers).not.toContain(replacedWinner);
});

test("top-8 single elimination advances active players without reseeding", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Top 8 Playoff",
      startDate: Date.now(),
      playerCapacity: 12,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await authed.mutation(api.tournaments.lifecycle.updatePairingsAutoPublish, {
    tournamentId,
    autoPublishPairings: true,
  });
  await seedActiveRegistrations(t, tournamentId, 12);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const swiss = await playOutCurrentRound(authed, tournamentId);
  const swissStandings = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: swiss.round._id,
    })
  ).map(({ standing }) => standing);
  const seeds = swissStandings.slice(0, 8).map((row) => row.playerId);

  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const quarterfinal = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  expect(quarterfinal.map(({ match }) => match.tableNumber)).toEqual([
    1, 2, 3, 4,
  ]);
  expect(
    quarterfinal.map(({ players }) => new Set(players.map((p) => p.playerId))),
  ).toEqual([
    new Set([seeds[0], seeds[7]]),
    new Set([seeds[3], seeds[4]]),
    new Set([seeds[1], seeds[6]]),
    new Set([seeds[2], seeds[5]]),
  ]);

  const setupAfterCut = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setupAfterCut.phases[1]).toMatchObject({
    phaseType: "single_elimination",
    phaseRoundMode: "fixed",
    phaseTotalRounds: 3,
  });
  expect(setupAfterCut.tournament.activeRegistrationCount).toBe(8);

  const firstQuarterfinal = quarterfinal[0];
  await expect(
    authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: firstQuarterfinal.match._id,
      playerOneRegistrationId: firstQuarterfinal.players[0].playerId,
      playerTwoRegistrationId: firstQuarterfinal.players[1].playerId,
      playerOneGameWins: 1,
      playerTwoGameWins: 1,
    }),
  ).rejects.toThrow("Single-elimination matches cannot end in a draw");

  const quarterfinalWinners = await recordFirstPlayerWins(authed, quarterfinal);
  const withdrawnWinner = quarterfinalWinners[0];
  const replacement = quarterfinal[0].players.find(
    (player) => player.playerId !== withdrawnWinner,
  );
  if (!replacement) {
    throw new Error("Expected a quarterfinal opponent to advance");
  }
  const replacementAdvancer = replacement.playerId;
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnWinner,
  });
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  expect(
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament.activeRegistrationCount,
  ).toBe(4);

  const lockedQuarterfinal = quarterfinal[1];
  const lockedWinner = lockedQuarterfinal.players[0].playerId;
  const lockedLoser = lockedQuarterfinal.players[1].playerId;
  await expect(
    authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: lockedQuarterfinal.match._id,
      playerOneRegistrationId: lockedWinner,
      playerTwoRegistrationId: lockedLoser,
      playerOneGameWins: 0,
      playerTwoGameWins: 2,
    }),
  ).rejects.toThrow(
    "Match results can only be recorded during an active round",
  );

  const registrationsAfterRejectedCorrection = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  const statusByRegistrationId = new Map(
    registrationsAfterRejectedCorrection.map(({ registration }) => [
      registration._id,
      registration.status,
    ]),
  );
  expect(statusByRegistrationId.get(lockedWinner)).toBe("active");
  expect(statusByRegistrationId.get(lockedLoser)).toBe("eliminated");

  const semifinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const semifinal = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: semifinalId },
  );
  expect(
    semifinal.map(({ players }) => new Set(players.map((p) => p.playerId))),
  ).toEqual([
    new Set([replacementAdvancer, quarterfinalWinners[1]]),
    new Set(quarterfinalWinners.slice(2, 4)),
  ]);
  expect(
    semifinal.flatMap(({ players }) =>
      players.map((player) => player.playerId),
    ),
  ).toContain(lockedWinner);
  expect(
    semifinal.flatMap(({ players }) =>
      players.map((player) => player.playerId),
    ),
  ).not.toContain(lockedLoser);
  expect(
    (
      await authed.query(api.tournaments.rounds.getCurrentRound, {
        tournamentId,
      })
    )?.roundName,
  ).toBe("Semifinals");

  const semifinalWinners = await recordFirstPlayerWins(authed, semifinal);
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: semifinalId,
  });
  const finalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const finalPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: finalId },
  );
  expect(new Set(finalPairings[0].players.map((p) => p.playerId))).toEqual(
    new Set(semifinalWinners),
  );
  expect(
    (
      await authed.query(api.tournaments.rounds.getCurrentRound, {
        tournamentId,
      })
    )?.roundName,
  ).toBe("Finals");

  await recordFirstPlayerWins(authed, finalPairings);
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: finalId,
  });
  const finishedSetup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(finishedSetup.tournament.activeRegistrationCount).toBe(1);
  expect(
    await authed.query(api.tournaments.rounds.getPairingsBoard, {
      tournamentId,
    }),
  ).toMatchObject({ nextStep: { kind: "completeTournament", ready: true } });
});

test("top-8 cut promotes the next-ranked active player when a qualifier drops", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Top 8 With Drop",
      startDate: Date.now(),
      playerCapacity: 12,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 12);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const swiss = await playOutCurrentRound(authed, tournamentId);
  const swissStandings = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: swiss.round._id,
    })
  ).map(({ standing }) => standing);
  const droppedQualifier = swissStandings[0].playerId;
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedQualifier,
  });

  const expectedSeeds = swissStandings
    .filter((standing) => standing.playerId !== droppedQualifier)
    .slice(0, 8)
    .map((standing) => standing.playerId);
  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const quarterfinal = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  const cutPlayers = quarterfinal.flatMap(({ players }) =>
    players.map((player) => player.playerId),
  );

  expect(new Set(cutPlayers)).toEqual(new Set(expectedSeeds));
  expect(cutPlayers).not.toContain(droppedQualifier);
  expect(cutPlayers).toContain(swissStandings[8].playerId);
  expect(
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament.activeRegistrationCount,
  ).toBe(8);
});

test("top-8 tournaments cannot start with fewer than eight active players", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Undersized Top 8",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 7);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  const board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toEqual({
    kind: "startTournament",
    ready: false,
    reason: "A top-8 playoff requires at least eight active players",
  });
  await expect(
    authed.mutation(api.tournaments.rounds.startTournament, { tournamentId }),
  ).rejects.toThrow("A top-8 playoff requires at least eight active players");
});

test("an unplayable top-8 phase can be cancelled after Swiss", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Top 8 With A Drop",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 2,
          phaseType: "single_elimination",
          phaseRoundMode: "fixed",
        },
      ],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 8);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(authed, tournamentId);

  const registrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrations[0].registration._id,
  });

  const board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toEqual({
    kind: "completeTournament",
    ready: true,
    reason: null,
  });

  await authed.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
  expect(setup.phases.map((phase) => phase.phaseStatus)).toEqual([
    "completed",
    "cancelled",
  ]);
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

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Simulation Check",
      dummyPlayerCount: 5,
      roundsToGenerate: 2,
      seed: 4242,
      autoStart: true,
    },
  );
  const registrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    {
      tournamentId,
    },
  );
  expect(registrations).toHaveLength(5);

  const roundOne = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(roundOne?.roundNumber).toBe(1);
  const roundOnePairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId: roundOne!._id,
    },
  );
  expect(roundOnePairings).toHaveLength(3);
  expect(
    roundOnePairings.some((pairing) =>
      pairing.players.some((player) => player.isBye),
    ),
  ).toBe(true);

  await authed.mutation(api.tournaments.testing.advanceTestRound, {
    tournamentId,
  });
  expect(
    await t.run(async (ctx) => await ctx.db.get(roundOne!._id)),
  ).toMatchObject({ pairingsPublishedAt: expect.any(Number) });
  const roundOneStandings = await authed.query(
    api.tournaments.rounds.listRoundStandings,
    {
      roundId: roundOne!._id,
    },
  );
  expect(roundOneStandings).toHaveLength(5);

  const roundTwo = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  expect(roundTwo?.roundNumber).toBe(2);
  await authed.mutation(api.tournaments.testing.advanceTestRound, {
    tournamentId,
  });

  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
  expect(setup.testConfig?.seed).toBe(4242);
  const testPlayer = t.withIdentity({
    issuer: "https://convex.test",
    subject: "test-player-1",
    tokenIdentifier: `test:${tournamentId}:player:1`,
  });
  expect(
    await testPlayer.query(api.tournaments.player.getMyMatchHistory, {
      tournamentId,
    }),
  ).toHaveLength(2);
  expect(
    await testPlayer.query(api.tournaments.player.getMyCurrentMatch, {
      tournamentId,
    }),
  ).toMatchObject({ kind: "between_rounds" });

  await authed.mutation(api.tournaments.testing.resetTestTournament, {
    tournamentId,
  });
  const resetSetup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  const resetRegistrations = await authed.query(
    api.tournaments.registrations.listRegistrations,
    { tournamentId },
  );
  const resetCurrentRound = await authed.query(
    api.tournaments.rounds.getCurrentRound,
    {
      tournamentId,
    },
  );
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

test("test round simulation converts draws into decisive elimination results", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Elimination Simulation Guard",
      dummyPlayerCount: 2,
      roundsToGenerate: 1,
      // The simulator's first result roll is below its draw threshold.
      seed: 972,
      autoStart: true,
    },
  );

  const round = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("Expected a current round");
  }

  await t.run(async (ctx) => {
    await ctx.db.patch(round.tournamentPhaseId, {
      phaseType: "single_elimination",
    });
  });

  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const currentRound = await ctx.db.get(round._id);
    if (!tournament || !currentRound) {
      throw new Error("Expected tournament and round");
    }
    await generateTestResults(ctx, tournament, currentRound);
  });

  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  expect(pairings[0].match.matchStatus).toBe("completed");
  expect(pairings[0].players).toHaveLength(2);
  const wins = pairings[0].players.map((player) => player.gameWins ?? 0);
  expect(wins[0]).not.toBe(wins[1]);
  for (const player of pairings[0].players) {
    expect(player.gameWins).toBeDefined();
    expect(player.gameLosses).toBeDefined();
  }
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
  await authed.mutation(api.tournaments.rounds.publishPairings, {
    roundId: round._id,
  });
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId: round._id,
    },
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

async function recordFirstPlayerWins(
  authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  pairings: Array<{
    match: { _id: Id<"tournamentMatches"> };
    players: Array<{ playerId: Id<"tournamentRegistrations"> }>;
  }>,
) {
  const winners: Id<"tournamentRegistrations">[] = [];
  for (const { match, players } of pairings) {
    if (players.length !== 2) {
      throw new Error("Expected a two-player elimination match");
    }
    winners.push(players[0].playerId);
    await authed.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  }
  return winners;
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
