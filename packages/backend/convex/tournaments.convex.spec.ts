/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  DEFERRED_STANDINGS_SYNC,
  MAX_TOURNAMENT_PLAYERS,
  setRegistrationState,
} from "./model/registrations";
import { generateTestResults } from "./model/testing";
import schema from "./schema";
import { organizerIdentity, seedOrganizer } from "./specHelpers";

const modules = import.meta.glob("./**/*.ts");

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
      decklistRequired: false,
      confirmedRegistrationCount: 0,
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
      decklistRequired: false,
      confirmedRegistrationCount: 0,
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
      tournamentStartDate: now + 60_000,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(rows.setupId, {
      confirmedRegistrationCount: 1,
    });
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

  const seeded = await t.run(async (ctx) => {
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
      decklistRequired: false,
      confirmedRegistrationCount: 1,
      updatedAt: now,
      name: "Private Live Event",
      visibility: "private",
      lifecycle: "in_progress",
      startDate: now - 60_000,
    });
    const registrationId = await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId: playerUserId,
      tournamentStartDate: now - 60_000,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { tournamentId, registrationId };
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

  // Cancelling keeps the page open. The row survives the cancellation, and it
  // is what registerSelf accepts as the invitation back into an invite-only
  // event, so hiding the tournament here would make "Cancel registration" a
  // one-way door with no screen left to act from.
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.registrationId, {
      entryStatus: "cancelled",
      participationStatus: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(seeded.tournamentId, {
      confirmedRegistrationCount: 0,
      updatedAt: Date.now(),
    });
  });
  expect(
    (
      await t
        .withIdentity(playerIdentity)
        .query(api.tournaments.lifecycle.getPublicTournament, {
          publicCode: "100001",
        })
    )?.tournament.name,
  ).toBe("Private Live Event");
});

// A private event refuses registrations from the public page, but a player who
// cancelled one still holds a row for it: that row is the record of an
// invitation already extended, so the cancel is reversible. Strangers still
// have no way in, and a row in any other entry status is refused by the status
// guard rather than the visibility one.
test("registerSelf lets a cancelled player rejoin a private event but admits no one new", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId, userId } = await seedOrganizer(t);
  const playerIdentity = {
    issuer: "https://convex.test",
    subject: "private-rejoin",
    tokenIdentifier: "https://convex.test|private-rejoin",
    email: "rejoin@example.test",
    name: "Rejoining Player",
  };
  const strangerIdentity = {
    issuer: "https://convex.test",
    subject: "private-stranger",
    tokenIdentifier: "https://convex.test|private-stranger",
    email: "outsider@example.test",
    name: "Outsider",
  };

  const tournamentId = await t.run(async (ctx) => {
    for (const identity of [playerIdentity, strangerIdentity]) {
      await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: identity === playerIdentity ? 2 : 3,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      });
    }
    return await ctx.db.insert("tournaments", {
      organizationId,
      createdBy: userId,
      publicCode: 100_002,
      playerCapacity: 32,
      format: "standard",
      isTestEvent: false,
      autoPublishPairings: false,
      decklistRequired: false,
      confirmedRegistrationCount: 0,
      updatedAt: now,
      name: "Private Invitational",
      visibility: "private",
      lifecycle: "registration",
      startDate: now + 60_000,
    });
  });

  const player = t.withIdentity(playerIdentity);
  // No row yet: even the invited player cannot self-register into a private
  // event. The organizer seeds the seat, exactly as they do today.
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Tournament is not open for registration");

  const registrationId = await t.run(async (ctx) => {
    const playerUser = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", playerIdentity.tokenIdentifier),
      )
      .unique();
    if (!playerUser) {
      throw new Error("Seeded player missing");
    }
    await ctx.db.patch(tournamentId, { confirmedRegistrationCount: 1 });
    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId: playerUser._id,
      tournamentStartDate: now + 60_000,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).resolves.toBe(registrationId);
  expect(
    await player.query(api.tournaments.registrations.getMyRegistration, {
      tournamentId,
    }),
  ).toMatchObject({ entryStatus: "confirmed", participationStatus: "active" });
  expect(
    (
      await t.run(async (ctx) => await ctx.db.get(tournamentId))
    )?.confirmedRegistrationCount,
  ).toBe(1);

  await expect(
    t
      .withIdentity(strangerIdentity)
      .mutation(api.tournaments.registrations.registerSelf, { tournamentId }),
  ).rejects.toThrow("Tournament is not open for registration");
});

// Every confirmed seat is listed, whatever its participation status: the
// player controller admits any confirmed entry, so a player who was dropped,
// eliminated, or disqualified mid-event must still find the running event
// here. Disqualifications are masked as drops on this player-facing surface.
test("listMyTournaments returns every confirmed seat for ongoing and upcoming events", async () => {
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

  const { disqualifiedFrom } = await t.run(async (ctx) => {
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
      decklistRequired: false,
      confirmedRegistrationCount: 0,
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
    const disqualifiedFromId = await ctx.db.insert("tournaments", {
      ...base,
      name: "Disqualified Event",
      visibility: "public",
      lifecycle: "in_progress",
      startDate: now + 30_000,
    });

    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: laterPublic,
      tournamentStartDate: now + 120_000,
      entryStatus: "confirmed",
      participationStatus: "active",
    });
    // Eliminated mid-event (a cut): the running event must stay listed so the
    // player keeps a route to the player controller.
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: inProgress,
      tournamentStartDate: now + 60_000,
      entryStatus: "confirmed",
      participationStatus: "eliminated",
    });
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: completed,
      tournamentStartDate: now - 60_000,
      entryStatus: "confirmed",
      participationStatus: "active",
    });
    // A withdrawal preserved by a round-one rewind: the seat is still held
    // (cancelling it is self-service), so the event stays discoverable.
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: droppedFrom,
      tournamentStartDate: now + 90_000,
      entryStatus: "confirmed",
      participationStatus: "dropped",
    });
    await ctx.db.insert("tournamentRegistrations", {
      ...registrationBase,
      tournamentId: disqualifiedFromId,
      tournamentStartDate: now + 30_000,
      entryStatus: "confirmed",
      participationStatus: "disqualified",
    });
    return { disqualifiedFrom: disqualifiedFromId };
  });

  const player = t.withIdentity(playerIdentity);
  const rows = await player.query(
    api.tournaments.registrations.listMyTournaments,
    {},
  );

  // Completed events drop out; everything else sorts by start date.
  expect(rows.map((row) => row.tournament.name)).toEqual([
    "Disqualified Event",
    "In Progress Event",
    "Dropped Event",
    "Later Public Event",
  ]);
  expect(rows[0].organizationName).toBe("Test Org");
  // Player-facing masking: the disqualification reads as a drop, here and on
  // the single-registration query the event pages branch on.
  expect(rows[0].registration.participationStatus).toBe("dropped");
  expect(rows[1].registration.participationStatus).toBe("eliminated");
  const myDisqualifiedRegistration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId: disqualifiedFrom },
  );
  expect(myDisqualifiedRegistration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "dropped",
  });

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
      decklistRequired: false,
      confirmedRegistrationCount: 0,
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
  const registrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  let registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(registration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });

  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(registration?.entryStatus).toBe("cancelled");
  expect(registration?.participationStatus).toBeUndefined();
  let counts = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(counts.tournament.confirmedRegistrationCount).toBe(0);

  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).resolves.toBe(registrationId);
  counts = await organizer.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(counts.tournament.confirmedRegistrationCount).toBe(1);
});

// F8: registerSelf's guard used to lump every non-cancelled row into a
// blanket "Already registered". The reserved review-flow entry statuses
// (pending, waitlisted, rejected — deliberate placeholders on
// tournamentEntryStatusValidator with no writer yet) must each surface their
// own honest error instead: none of them is a confirmed seat, and for a
// rejected player the old message described the organizer's decision as the
// player's own completed registration. The states are seeded directly via
// ctx.db because no mutation writes them yet.
test("registerSelf reports each entry status honestly instead of a blanket 'Already registered'", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Reserved Entry States",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const player = t.withIdentity({
    issuer: "https://convex.test",
    subject: "reserved-states-player",
    tokenIdentifier: "https://convex.test|reserved-states-player",
    email: "reserved-states@example.test",
    name: "Reserved States Player",
  });
  const registrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );

  // A confirmed seat still reads as already registered.
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Already registered");

  // Stamp each reserved state the way setRegistrationState would (a
  // non-confirmed entry carries no participation status) and pin its message.
  const stampEntryStatus = async (
    entryStatus: "pending" | "waitlisted" | "rejected",
  ) =>
    await t.run(async (ctx) => {
      await ctx.db.patch(registrationId, {
        entryStatus,
        participationStatus: undefined,
      });
    });

  await stampEntryStatus("pending");
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Your registration is pending review");

  await stampEntryStatus("waitlisted");
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("You are on the waitlist for this event");

  // A rejection is an organizer decision: registerSelf must neither bypass it
  // nor misreport it as the player's own completed registration.
  await stampEntryStatus("rejected");
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Your registration was declined");

  // The blocked attempts left the row exactly as stamped — no confirmed
  // re-entry slipped through. (Every attempt above rejected, so the insert
  // branch past the guard was never reached either.)
  const row = await t.run(async (ctx) => await ctx.db.get(registrationId));
  expect(row).toMatchObject({ entryStatus: "rejected" });
  expect(row?.participationStatus).toBeUndefined();
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

test("organizers can page through registration churn beyond tournament capacity", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Registration Churn",
      startDate: now + 86_400_000,
      playerCapacity: 2,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  const insertedRegistrationIds = await t.run(async (ctx) => {
    const ids: Array<Id<"tournamentRegistrations">> = [];
    for (let playerNumber = 1; playerNumber <= 5; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `churn-player:${playerNumber}`,
        publicCode: playerNumber + 100,
        name: `Churn Player ${playerNumber}`,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          tournamentStartDate: now + 86_400_000,
          entryStatus: "cancelled",
          playerName: `Churn Player ${playerNumber}`,
          createdAt: now + playerNumber,
          updatedAt: now + playerNumber,
        }),
      );
    }
    return ids;
  });

  const firstPage = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      paginationOpts: { cursor: null, numItems: 2 },
    },
  );
  const secondPage = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 2,
      },
    },
  );
  const thirdPage = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      paginationOpts: {
        cursor: secondPage.continueCursor,
        numItems: 2,
      },
    },
  );

  const returnedRegistrationIds = [
    ...firstPage.page,
    ...secondPage.page,
    ...thirdPage.page,
  ].map(({ registration }) => registration._id);
  expect(firstPage.isDone).toBe(false);
  expect(secondPage.isDone).toBe(false);
  expect(thirdPage.isDone).toBe(true);
  expect(new Set(returnedRegistrationIds)).toEqual(
    new Set(insertedRegistrationIds),
  );
  expect(returnedRegistrationIds).toHaveLength(insertedRegistrationIds.length);
});

test("a full registration page is not flagged for splitting", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Large Roster",
      startDate: now + 86_400_000,
      playerCapacity: 200,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  const ROW_COUNT = 120;
  const insertedRegistrationIds = await t.run(async (ctx) => {
    const ids: Array<Id<"tournamentRegistrations">> = [];
    for (let playerNumber = 1; playerNumber <= ROW_COUNT; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `large-roster-player:${playerNumber}`,
        publicCode: playerNumber + 500,
        name: `Large Roster Player ${playerNumber}`,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          tournamentStartDate: now + 86_400_000,
          entryStatus: "cancelled",
          playerName: `Large Roster Player ${playerNumber}`,
          createdAt: now + playerNumber,
          updatedAt: now + playerNumber,
        }),
      );
    }
    return ids;
  });

  // Mirrors the web client's initialNumItems (registrations-view.tsx),
  // which is what makes a full page here also equal the server's page-size
  // cap — the exact condition F10 was about.
  const firstPage = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      paginationOpts: { cursor: null, numItems: 100 },
    },
  );

  // A full, unfiltered 100-row page must settle rather than being flagged
  // for a client-driven split. Before the fix, maximumRowsRead was pinned to
  // the same value as the clamped numItems, so rowsRead reached the cap on
  // the very doc that filled the page and convex-test's pagination engine
  // (mirroring the real backend: see node_modules/convex-test's db.paginate,
  // which sets pageStatus "SplitRequired" once rowsRead >= maximumRowsRead)
  // marked the page SplitRequired even though nothing was actually filtered
  // out.
  expect(firstPage.page).toHaveLength(100);
  expect(firstPage.isDone).toBe(false);
  expect(firstPage.pageStatus ?? null).toBeNull();

  const secondPage = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 100 },
    },
  );
  expect(secondPage.page).toHaveLength(ROW_COUNT - 100);
  expect(secondPage.isDone).toBe(true);
  expect(secondPage.pageStatus ?? null).toBeNull();

  const returnedRegistrationIds = [...firstPage.page, ...secondPage.page].map(
    ({ registration }) => registration._id,
  );
  expect(new Set(returnedRegistrationIds)).toEqual(
    new Set(insertedRegistrationIds),
  );
  expect(returnedRegistrationIds).toHaveLength(insertedRegistrationIds.length);
});

test("organizers can search registrations by player name scoped to one tournament", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const createTournament = (name: string) =>
    organizer.mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name,
      startDate: now + 86_400_000,
      playerCapacity: 2,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });
  const tournamentId = await createTournament("Roster Search");
  const otherTournamentId = await createTournament("Roster Search Other");

  await t.run(async (ctx) => {
    const players: Array<{
      playerName: string;
      registeredIn: Id<"tournaments">;
    }> = [
      { playerName: "Alice Adams", registeredIn: tournamentId },
      { playerName: "Bob Brown", registeredIn: tournamentId },
      // Same first name in another tournament must not leak into results.
      { playerName: "Alice Bishop", registeredIn: otherTournamentId },
    ];
    for (const [index, { playerName, registeredIn }] of players.entries()) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `search-player:${index}`,
        publicCode: index + 200,
        name: playerName,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId: registeredIn,
        userId,
        tournamentStartDate: now + 86_400_000,
        entryStatus: "cancelled",
        playerName,
        createdAt: now + index,
        updatedAt: now + index,
      });
    }
  });

  const matches = await organizer.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Alice" },
  );

  expect(matches.map(({ playerName }) => playerName)).toEqual(["Alice Adams"]);
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
      tournamentStartDate: now + 86_400_000,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: 1,
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

  const registrations = await listRegistrations(authed, tournamentId);
  expect(registrations).toHaveLength(32);

  const secondSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    {
      tournamentId,
      count: 32,
    },
  );
  expect(secondSeed.addedCount).toBe(0);

  const afterSecondSeed = await listRegistrations(authed, tournamentId);
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
      tournamentStartDate: now + 86_400_000,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: 1,
    });
  });

  // With one seat already taken, asking for 5 must add exactly 5 (seats to
  // add). The old "target total" semantics would have added only 4 here.
  const firstSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 5 },
  );
  expect(firstSeed.addedCount).toBe(5);
  expect(await listRegistrations(authed, tournamentId)).toHaveLength(6);

  // A count of 1 must not throw (the old code routed count through
  // validCapacity, which rejected anything below 2) and adds exactly one.
  const secondSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 1 },
  );
  expect(secondSeed.addedCount).toBe(1);
  expect(await listRegistrations(authed, tournamentId)).toHaveLength(7);

  // Requesting more than the remaining capacity is clamped to what fits.
  const thirdSeed = await authed.mutation(
    api.tournaments.testing.seedTestPlayers,
    { tournamentId, count: 100 },
  );
  expect(thirdSeed.addedCount).toBe(25);
  expect(await listRegistrations(authed, tournamentId)).toHaveLength(32);
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
  updated = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
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
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
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
    "Player capacity cannot be lower than the confirmed registration count",
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

test("updateTournamentSetup rejects a non-finite start date and never corrupts registrations", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Bad Start Date",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 3);
  const before = await t.run(async (ctx) => await ctx.db.get(tournamentId));

  for (const startDate of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    await expect(
      organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
        tournamentId,
        startDate,
      }),
    ).rejects.toThrow("Tournament start date must be a valid date");
  }

  const after = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  expect(after?.startDate).toBe(before?.startDate);

  const registrations = await t.run(
    async (ctx) =>
      await ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_userId", (q) =>
          q.eq("tournamentId", tournamentId),
        )
        .collect(),
  );
  expect(registrations.length).toBeGreaterThan(0);
  for (const registration of registrations) {
    expect(Number.isFinite(registration.tournamentStartDate)).toBe(true);
    expect(registration.tournamentStartDate).toBe(before?.startDate);
  }
});

// F05 (creation path) / F16: attempt 1 only guarded updateTournamentSetup,
// leaving both public creation mutations free to persist a non-finite
// startDate straight onto the new tournament document — which registerSelf
// then copies onto every registration with no validation of its own. Both
// createTournament and createTournamentWithPhases funnel through the same
// model/tournaments.ts createTournament, so a single validStartDate call
// there closes both entry points at once.
test("createTournament and createTournamentWithPhases reject a non-finite start date", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);

  for (const startDate of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    await expect(
      organizer.mutation(
        api.tournaments.lifecycle.createTournamentWithPhases,
        {
          organizationId,
          name: "Bad Start Date",
          startDate,
          playerCapacity: 8,
          format: "standard",
          phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
        },
      ),
    ).rejects.toThrow("Tournament start date must be a valid date");

    await expect(
      organizer.mutation(api.tournaments.lifecycle.createTournament, {
        organizationId,
        name: "Bad Start Date",
        startDate,
        playerCapacity: 8,
        format: "standard",
      }),
    ).rejects.toThrow("Tournament start date must be a valid date");
  }

  // Every rejection above must have rolled back its transaction, so there is
  // no half-created tournament left behind for a later registerSelf to
  // corrupt with a non-finite tournamentStartDate.
  const tournaments = await t.run(
    async (ctx) => await ctx.db.query("tournaments").collect(),
  );
  expect(tournaments).toHaveLength(0);
});

// Pins the mechanism that keeps F05's exact failure scenario (create with a
// non-finite startDate, then registerSelf, with updateTournamentSetup never
// called) closed: since creation itself now validates, a tournament that
// exists at all always has a finite startDate, so registerSelf's direct copy
// of tournament.startDate onto tournamentStartDate can never observe a
// non-finite value.
test("registerSelf never denormalizes a non-finite tournament start date", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Valid Start Date",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  const player = t.withIdentity({
    issuer: "https://convex.test",
    subject: "finite-start-date-player",
    tokenIdentifier: "https://convex.test|finite-start-date-player",
    email: "finite-start-date-player@example.test",
    name: "Finite Start Date Player",
  });
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });

  const registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(Number.isFinite(registration?.tournamentStartDate)).toBe(true);
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  expect(registration?.tournamentStartDate).toBe(tournament?.startDate);
});

// F17: Math.trunc(NaN) is NaN, and both `NaN < 2` and `NaN > MAX` are false,
// so the old range check silently let a NaN playerCapacity through on every
// caller (createTournament, createTournamentWithPhases, and
// updateTournamentSetup all route through the shared validCapacity helper).
// ±Infinity already truncated to themselves and failed the range check, so
// only NaN is a new rejection here — asserted alongside the infinities to pin
// that they still reject too.
test("createTournament, createTournamentWithPhases, and updateTournamentSetup reject a non-finite player capacity", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const capacityErrorMessage = `Player capacity must be between 2 and ${MAX_TOURNAMENT_PLAYERS}`;

  for (const playerCapacity of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    await expect(
      organizer.mutation(
        api.tournaments.lifecycle.createTournamentWithPhases,
        {
          organizationId,
          name: "Bad Capacity",
          startDate: Date.now(),
          playerCapacity,
          format: "standard",
          phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
        },
      ),
    ).rejects.toThrow(capacityErrorMessage);

    await expect(
      organizer.mutation(api.tournaments.lifecycle.createTournament, {
        organizationId,
        name: "Bad Capacity",
        startDate: Date.now(),
        playerCapacity,
        format: "standard",
      }),
    ).rejects.toThrow(capacityErrorMessage);
  }

  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Valid Capacity",
      startDate: Date.now(),
      playerCapacity: 4,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await expect(
    organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      playerCapacity: Number.NaN,
    }),
  ).rejects.toThrow(capacityErrorMessage);

  const after = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  expect(after?.playerCapacity).toBe(4);

  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  // With capacity validated at every write path, requireCapacityAvailable's
  // `count >= playerCapacity` gate can never be handed a NaN cap, so a small
  // field really does fill up instead of accepting registrations forever.
  for (let playerNumber = 1; playerNumber <= 4; playerNumber += 1) {
    const player = t.withIdentity({
      issuer: "https://convex.test",
      subject: `capacity-player-${playerNumber}`,
      tokenIdentifier: `https://convex.test|capacity-player-${playerNumber}`,
      email: `capacity-player-${playerNumber}@example.test`,
      name: `Capacity Player ${playerNumber}`,
    });
    await player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    });
  }
  const overCapacityPlayer = t.withIdentity({
    issuer: "https://convex.test",
    subject: "capacity-player-5",
    tokenIdentifier: "https://convex.test|capacity-player-5",
    email: "capacity-player-5@example.test",
    name: "Capacity Player 5",
  });
  await expect(
    overCapacityPlayer.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow();
});

// createTestTournament (tournaments/testing.ts) writes the same
// tournaments.startDate field as the two public creation mutations above,
// via `args.startDate ?? now` with no validation of the caller-supplied
// value — the identical hole, fixed with the same validStartDate helper.
test("createTestTournament rejects a non-finite start date", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);

  for (const startDate of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    await expect(
      organizer.mutation(api.tournaments.testing.createTestTournament, {
        organizationId,
        name: "Bad Test Start Date",
        startDate,
        dummyPlayerCount: 4,
      }),
    ).rejects.toThrow("Tournament start date must be a valid date");
  }

  const tournaments = await t.run(
    async (ctx) => await ctx.db.query("tournaments").collect(),
  );
  expect(tournaments).toHaveLength(0);
});

test("updateTournamentPhases rejects duplicate and foreign phase IDs", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentIds = await Promise.all(
    ["First Event", "Second Event"].map((name) =>
      organizer.mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
        organizationId,
        name,
        startDate: Date.now(),
        playerCapacity: 8,
        format: "standard",
        phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
      }),
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

async function createCutoffTournament(
  t: ReturnType<typeof convexTest>,
  phaseCutoff:
    | { kind: "top_X_players"; playerCount: number }
    | { kind: "X_points_or_more"; matchPoints: number },
) {
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Cutoff Event",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
          phaseCutoff,
        },
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
  return { authed, tournamentId };
}

test("a top-X cutoff eliminates non-qualifiers when the next phase starts", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "top_X_players",
    playerCount: 2,
  });

  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  const topTwo = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRound._id,
    })
  )
    .map(({ standing }) => standing)
    .slice(0, 2)
    .map((standing) => standing.playerId);

  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // The phase-2 field is exactly the top two; everyone else is eliminated,
  // keyed to phase 1's final round so a rewind can restore them.
  const nextRound = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId: nextRound!._id,
    },
  );
  expect(pairings).toHaveLength(1);
  expect(pairings[0].players.map((player) => player.playerId).sort()).toEqual(
    [...topTwo].sort(),
  );

  await t.run(async (ctx) => {
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .collect();
    const eliminated = registrations.filter(
      (registration) => registration.participationStatus === "eliminated",
    );
    expect(eliminated).toHaveLength(2);
    for (const registration of eliminated) {
      expect(registration.eliminatedByRoundId).toBe(finalRound._id);
    }
  });
});

test("a points cutoff advances every player at or above the bar", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "X_points_or_more",
    matchPoints: 3,
  });

  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  const qualified = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRound._id,
    })
  )
    .map(({ standing }) => standing)
    .filter((standing) => standing.matchPoints >= 3)
    .map((standing) => standing.playerId);
  expect(qualified).toHaveLength(2);

  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const nextRound = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    {
      roundId: nextRound!._id,
    },
  );
  expect(pairings).toHaveLength(1);
  expect(pairings[0].players.map((player) => player.playerId).sort()).toEqual(
    [...qualified].sort(),
  );
});

test("a cutoff nobody clears ends the tournament instead of pairing the next phase", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "X_points_or_more",
    matchPoints: 6,
  });

  await playOutCurrentRound(authed, tournamentId);

  // After one round nobody has six points, so the next phase is unpairable:
  // the board offers completion, and generating the round refuses.
  const board = await authed.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "completeTournament",
    ready: true,
  });
  await expect(
    authed.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    }),
  ).rejects.toThrow("fewer than two qualifying players");

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

test("a cutoff nobody clears cancels every later phase, not just the next one", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Three Phase Cutoff Event",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
          phaseCutoff: { kind: "X_points_or_more", matchPoints: 6 },
        },
        {
          phaseOrder: 2,
          phaseType: "swiss",
          phaseRoundMode: "fixed",
          phaseTotalRounds: 1,
        },
        {
          phaseOrder: 3,
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

  // After one round nobody has six points, so no later phase can be played.
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
    "cancelled",
  ]);
});

test("rewinding the round after a cutoff restores the eliminated players", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "top_X_players",
    playerCount: 2,
  });

  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  await t.run(async (ctx) => {
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .collect();
    expect(
      registrations.every(
        (registration) => registration.participationStatus === "active",
      ),
    ).toBe(true);
  });
  const reopenedRound = await authed.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  expect(reopenedRound?._id).toBe(finalRound._id);
  expect(reopenedRound?.roundStatus).toBe("in_progress");
});

test("phase cutoffs are validated against the phase structure", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const createWithPhases = (
    phases: Array<{
      phaseOrder: number;
      phaseType?: "swiss" | "single_elimination";
      phaseRoundMode: "dynamic" | "fixed";
      phaseTotalRounds?: number;
      phaseCutoff?:
        | { kind: "top_X_players"; playerCount: number }
        | { kind: "X_points_or_more"; matchPoints: number }
        | null;
    }>,
  ) =>
    authed.mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Cutoff Validation",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases,
    });

  // The final phase has nothing to cut into.
  await expect(
    createWithPhases([
      {
        phaseOrder: 1,
        phaseRoundMode: "dynamic",
        phaseCutoff: { kind: "top_X_players", playerCount: 8 },
      },
    ]),
  ).rejects.toThrow("A phase cutoff requires a following Swiss phase");

  // A phase feeding the playoff cannot configure one — the playoff applies
  // its own fixed top-8 cut.
  await expect(
    createWithPhases([
      {
        phaseOrder: 1,
        phaseRoundMode: "dynamic",
        phaseCutoff: { kind: "top_X_players", playerCount: 8 },
      },
      {
        phaseOrder: 2,
        phaseType: "single_elimination",
        phaseRoundMode: "fixed",
      },
    ]),
  ).rejects.toThrow("A phase cutoff requires a following Swiss phase");

  // A cut keeping fewer than two players could never pair the next phase.
  await expect(
    createWithPhases([
      {
        phaseOrder: 1,
        phaseRoundMode: "dynamic",
        phaseCutoff: { kind: "top_X_players", playerCount: 1 },
      },
      { phaseOrder: 2, phaseRoundMode: "dynamic" },
    ]),
  ).rejects.toThrow("player-count cutoff");

  // A valid configuration persists on the phase document.
  const tournamentId = await createWithPhases([
    {
      phaseOrder: 1,
      phaseRoundMode: "dynamic",
      phaseCutoff: { kind: "X_points_or_more", matchPoints: 9 },
    },
    { phaseOrder: 2, phaseRoundMode: "dynamic" },
  ]);
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.phases[0].phaseCutoff).toEqual({
    kind: "X_points_or_more",
    matchPoints: 9,
  });
  expect(setup.phases[1].phaseCutoff).toBeNull();

  // updateTournamentPhases persists and clears cutoffs the same way.
  await authed.mutation(api.tournaments.lifecycle.updateTournamentPhases, {
    tournamentId,
    phases: [
      {
        phaseId: setup.phases[0]._id,
        phaseOrder: 1,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
        phaseCutoff: { kind: "top_X_players", playerCount: 4 },
      },
      {
        phaseId: setup.phases[1]._id,
        phaseOrder: 2,
        phaseType: "swiss",
        phaseRoundMode: "dynamic",
      },
    ],
  });
  const updated = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(updated.phases[0].phaseCutoff).toEqual({
    kind: "top_X_players",
    playerCount: 4,
  });
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
  const cutRegistrations = await listRegistrations(authed, tournamentId);
  const withdrawnCutPlayer = cutRegistrations.find(
    ({ registration }) => registration.participationStatus === "eliminated",
  );
  if (!withdrawnCutPlayer) {
    throw new Error("Expected a player below the playoff cut");
  }
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnCutPlayer.registration._id,
  });

  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  const registrationsAfterRewind = await listRegistrations(
    authed,
    tournamentId,
  );
  expect(
    registrationsAfterRewind.find(
      ({ registration }) =>
        registration._id === withdrawnCutPlayer.registration._id,
    )?.registration.participationStatus,
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

test("reinstating a dropped eliminated player restores the elimination, not active play", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Cut Revival Guard",
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
  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  const [firstCutPlayer, secondCutPlayer] = [
    ...(await registrationsById()).values(),
  ].filter((registration) => registration.participationStatus === "eliminated");
  expect(secondCutPlayer).toBeDefined();

  // Dropping a cut player then reinstating them must not revive them into
  // the bracket: the elimination survives the withdrawal round-trip.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: firstCutPlayer._id,
  });
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: firstCutPlayer._id,
  });
  const reinstated = (await registrationsById()).get(firstCutPlayer._id);
  expect(reinstated?.participationStatus).toBe("eliminated");
  expect(reinstated?.eliminatedByRoundId).toBe(swiss.round._id);

  // Rewinding the cut restores the reinstated player like any other cut
  // player, while a still-withdrawn player stays dropped but sheds the
  // undone elimination so a later reinstate returns them to active play.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: secondCutPlayer._id,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const afterRewind = await registrationsById();
  expect(afterRewind.get(firstCutPlayer._id)?.participationStatus).toBe(
    "active",
  );
  expect(afterRewind.get(secondCutPlayer._id)?.participationStatus).toBe(
    "dropped",
  );
  expect(
    afterRewind.get(secondCutPlayer._id)?.eliminatedByRoundId,
  ).toBeUndefined();
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: secondCutPlayer._id,
  });
  expect(
    (await registrationsById()).get(secondCutPlayer._id)?.participationStatus,
  ).toBe("active");
});

test("re-completing a rewound bracket round re-records a dropped loser's elimination", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Bracket Loser Restamp",
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
  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const quarterfinalPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  await recordFirstPlayerWins(authed, quarterfinalPairings);
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  const loserId = quarterfinalPairings[0].players[1].playerId;
  expect((await registrationsById()).get(loserId)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: quarterfinalId,
  });

  // Drop the eliminated loser (preserving the elimination), then rewind the
  // semifinal: reopening the quarterfinal clears the preserved reference.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: loserId,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const afterRewind = (await registrationsById()).get(loserId);
  expect(afterRewind?.participationStatus).toBe("dropped");
  expect(afterRewind?.eliminatedByRoundId).toBeUndefined();

  // Re-completing the quarterfinal with the same results re-records the
  // dropped loser's elimination without disturbing the withdrawal...
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  const afterRecomplete = (await registrationsById()).get(loserId);
  expect(afterRecomplete?.participationStatus).toBe("dropped");
  expect(afterRecomplete?.eliminatedByRoundId).toBe(quarterfinalId);

  // ...so reinstating restores the elimination, not active play.
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: loserId,
  });
  expect((await registrationsById()).get(loserId)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: quarterfinalId,
  });
});

// disqualifyRegistration doesn't exist yet (F01: "disqualified" is a
// reserved placeholder with no writer), so this pins setRegistrationState's
// contract directly, ahead of that mutation landing.
test("disqualifying an eliminated player preserves the elimination record", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Disqualify Preserves Elimination",
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
  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const quarterfinalPairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  await recordFirstPlayerWins(authed, quarterfinalPairings);
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: quarterfinalId,
  });
  const loserId = quarterfinalPairings[0].players[1].playerId;
  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  expect((await registrationsById()).get(loserId)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: quarterfinalId,
  });

  // Disqualifying an already-eliminated player must not erase *when* they
  // left: omitting eliminatedByRoundId keeps the existing stamp, exactly
  // like the drop transition (F04).
  await t.run(async (ctx) => {
    await setRegistrationState(ctx, loserId, {
      entryStatus: "confirmed",
      participationStatus: "disqualified",
    });
  });
  expect((await registrationsById()).get(loserId)).toMatchObject({
    participationStatus: "disqualified",
    eliminatedByRoundId: quarterfinalId,
  });

  // Passing null still clears a preserved elimination on purpose, exactly
  // like the drop transition's three-way contract.
  await t.run(async (ctx) => {
    await setRegistrationState(ctx, loserId, {
      entryStatus: "confirmed",
      participationStatus: "disqualified",
      eliminatedByRoundId: null,
    });
  });
  expect(
    (await registrationsById()).get(loserId)?.eliminatedByRoundId,
  ).toBeUndefined();
});

// Every non-confirmed transition today runs in lifecycle "registration",
// where no standings rows exist, so no mutation can reach this yet. This pins
// setRegistrationState's contract ahead of the flows that will (an
// approval/rejection of a mid-play entry, a mid-play cancel): a standings row
// has no value meaning "not entered" — readers render an absent status as
// Active — so leaving the confirmed state while a row exists must throw
// rather than silently stamp a dropped player's row back to Active.
test("a registration cannot leave the confirmed state while it holds a standings row", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Cancel With Standings",
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
  await playOutCurrentRound(authed, tournamentId);

  const [{ registration: target }] = await listRegistrations(
    authed,
    tournamentId,
  );
  const latestStandingsRow = async () =>
    await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("roundStandings")
            .withIndex("by_playerId", (q) => q.eq("playerId", target._id))
            .order("desc")
            .take(1)
        )[0],
    );
  expect((await latestStandingsRow())?.participationStatus).toBe("active");

  // The default sync would stamp the cleared status onto the row — rendered
  // as Active by every reader — so the transition throws instead, before
  // touching the row.
  await expect(
    t.run(async (ctx) => {
      await setRegistrationState(ctx, target._id, {
        entryStatus: "cancelled",
      });
    }),
  ).rejects.toThrow(/cannot leave the confirmed state/);
  expect((await latestStandingsRow())?.participationStatus).toBe("active");

  // The guard is about standings rows, not lifecycles: a confirmed entry
  // with no row (confirmed after the round completed, so never ranked) can
  // still leave the confirmed state.
  const lateRegistrationId = await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "player:late",
      publicCode: 99,
      email: "late@example.test",
      name: "Late Player",
      updatedAt: now,
    });
    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId,
      tournamentStartDate: tournament.startDate,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
  });
  await t.run(async (ctx) => {
    await setRegistrationState(ctx, lateRegistrationId, {
      entryStatus: "cancelled",
    });
  });
  expect(
    await t.run(async (ctx) => await ctx.db.get(lateRegistrationId)),
  ).toMatchObject({ entryStatus: "cancelled" });

  // DEFERRED_STANDINGS_SYNC stays the explicit escape hatch: passing it is
  // the caller claiming it rewrites or deletes the rows itself in the same
  // transaction, so the guard does not second-guess it and the row is left
  // untouched for that repair.
  await t.run(async (ctx) => {
    await setRegistrationState(
      ctx,
      target._id,
      { entryStatus: "cancelled" },
      DEFERRED_STANDINGS_SYNC,
    );
  });
  expect(
    await t.run(async (ctx) => await ctx.db.get(target._id)),
  ).toMatchObject({ entryStatus: "cancelled" });
  expect((await latestStandingsRow())?.participationStatus).toBe("active");
});

test("re-running a rewound cutoff re-records a dropped non-qualifier's elimination", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "top_X_players",
    playerCount: 2,
  });
  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  const cutPlayer = [...(await registrationsById()).values()].find(
    (registration) => registration.participationStatus === "eliminated",
  );
  if (!cutPlayer) {
    throw new Error("Expected a player below the cutoff");
  }
  expect(cutPlayer.eliminatedByRoundId).toBe(finalRound._id);

  // Drop the cut player, then rewind phase 2's first round: reopening the
  // phase-final round clears the preserved elimination.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: cutPlayer._id,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const afterRewind = (await registrationsById()).get(cutPlayer._id);
  expect(afterRewind?.participationStatus).toBe("dropped");
  expect(afterRewind?.eliminatedByRoundId).toBeUndefined();

  // Re-completing the round with the same results and re-running the cut
  // re-records the dropped non-qualifier's elimination...
  await authed.mutation(api.tournaments.rounds.completeRound, {
    roundId: finalRound._id,
  });
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const afterRecut = (await registrationsById()).get(cutPlayer._id);
  expect(afterRecut?.participationStatus).toBe("dropped");
  expect(afterRecut?.eliminatedByRoundId).toBe(finalRound._id);

  // ...so reinstating restores the elimination, not active play.
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: cutPlayer._id,
  });
  expect((await registrationsById()).get(cutPlayer._id)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRound._id,
  });
});

test("a cut with no player meeting eliminates dropped players ranked above the boundary", async () => {
  const t = convexTest(schema, modules);
  const { authed, tournamentId } = await createCutoffTournament(t, {
    kind: "top_X_players",
    playerCount: 2,
  });
  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  const ranked = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRound._id,
    })
  ).map(({ standing }) => standing.playerId);
  expect(ranked).toHaveLength(4);

  // The rank-1 player withdraws after the phase-final round but before the
  // next phase is paired. Nothing has frozen the entry field yet, so their
  // slot goes to the next active player instead of being held for them.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[0],
  });
  await authed.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  const nextRound = await authed.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: nextRound!._id },
  );
  expect(
    pairings
      .flatMap(({ players }) => players.map((player) => player.playerId))
      .sort(),
  ).toEqual([ranked[1], ranked[2]].sort());

  // Qualifiers and stamped players are exact complements: every confirmed
  // participant who is not in the phase-2 field carries the cut's round id,
  // whether they were active or dropped when the cut ran.
  const afterCut = await registrationsById();
  expect(afterCut.get(ranked[3])).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRound._id,
  });
  expect(afterCut.get(ranked[0])).toMatchObject({
    participationStatus: "dropped",
    eliminatedByRoundId: finalRound._id,
  });

  // So reinstating the dropped non-qualifier restores their elimination
  // instead of adding a ninth wheel to a field they never qualified for.
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: ranked[0],
  });
  expect((await registrationsById()).get(ranked[0])).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRound._id,
  });
});

test("a top-8 cut eliminates a dropped player the standings rank inside the bracket", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Playoff Drop Above The Cut",
      startDate: Date.now(),
      playerCapacity: 16,
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
  const { round: finalRound } = await playOutCurrentRound(authed, tournamentId);
  const ranked = (
    await authed.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRound._id,
    })
  ).map(({ standing }) => standing.playerId);

  // A player inside the top 8 withdraws before the bracket is paired: the
  // rank-9 player backfills the vacated slot, so the bracket still seats
  // eight and the withdrawn player is not one of them.
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[2],
  });
  const quarterfinalId = await authed.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const bracketIds = (
    await authed.query(api.tournaments.rounds.listRoundPairings, {
      roundId: quarterfinalId,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));
  expect(bracketIds).toHaveLength(8);
  expect(bracketIds).not.toContain(ranked[2]);

  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  expect((await registrationsById()).get(ranked[2])).toMatchObject({
    participationStatus: "dropped",
    eliminatedByRoundId: finalRound._id,
  });

  // Reinstating them must not add a ninth player to an eight-slot bracket.
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: ranked[2],
  });
  expect((await registrationsById()).get(ranked[2])).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRound._id,
  });
});

test("a withdrawal preserved by a round-one rewind can be reinstated before play restarts", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Rewound Withdrawal Reinstate",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 4);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const [{ registration: withdrawnPlayer }] = await listRegistrations(
    authed,
    tournamentId,
  );
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnPlayer._id,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  // The withdrawal survives the rewind; only an explicit reinstate undoes it.
  expect((await registrationsById()).get(withdrawnPlayer._id)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "dropped",
  });

  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: withdrawnPlayer._id,
  });
  const reinstated = (await registrationsById()).get(withdrawnPlayer._id);
  expect(reinstated?.participationStatus).toBe("active");
  expect(reinstated?.eliminatedByRoundId).toBeUndefined();
  // The dropped row never left the confirmed count, so reinstating it must
  // not double-book the seat.
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.confirmedRegistrationCount).toBe(4);

  const roundId = await authed.mutation(
    api.tournaments.rounds.startTournament,
    { tournamentId },
  );
  await authed.mutation(api.tournaments.rounds.publishPairings, { roundId });
  const pairings = await authed.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId },
  );
  expect(
    pairings.flatMap(({ players }) => players.map((player) => player.playerId)),
  ).toContain(withdrawnPlayer._id);
});

test("a withdrawal preserved by a round-one rewind can be dropped pre-play to free the seat", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Rewound Withdrawal Cancel",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 4);
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await authed.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const [{ registration: withdrawnPlayer }] = await listRegistrations(
    authed,
    tournamentId,
  );
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnPlayer._id,
  });
  await authed.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  const registrationsById = async () =>
    new Map(
      (await listRegistrations(authed, tournamentId)).map(
        ({ registration }) => [registration._id, registration],
      ),
    );
  const setup = async () =>
    (
      await authed.query(api.tournaments.lifecycle.getTournamentSetup, {
        tournamentId,
      })
    ).tournament;
  // The mid-play withdrawal still occupies its confirmed seat after the
  // rewind; dropping it again pre-play converts it to a cancelled entry.
  expect((await setup()).confirmedRegistrationCount).toBe(4);
  await authed.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnPlayer._id,
  });
  const cancelled = (await registrationsById()).get(withdrawnPlayer._id);
  expect(cancelled?.entryStatus).toBe("cancelled");
  expect(cancelled?.participationStatus).toBeUndefined();
  expect((await setup()).confirmedRegistrationCount).toBe(3);

  // From here the entry follows the normal pre-play cancelled path.
  await authed.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: withdrawnPlayer._id,
  });
  expect((await registrationsById()).get(withdrawnPlayer._id)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect((await setup()).confirmedRegistrationCount).toBe(4);
});

test("a player whose withdrawal survived a rewind can cancel and re-register", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Rewound Withdrawal Self-Service",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 3);
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const player = t.withIdentity({
    issuer: "https://convex.test",
    subject: "rewound-player",
    tokenIdentifier: "https://convex.test|rewound-player",
    email: "rewound@example.test",
    name: "Rewound Player",
  });
  const registrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await player.mutation(api.tournaments.player.dropSelf, { tournamentId });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  // The preserved withdrawal still holds the seat; cancelling releases it.
  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  let registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(registration?.entryStatus).toBe("cancelled");
  expect(registration?.participationStatus).toBeUndefined();
  let setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.confirmedRegistrationCount).toBe(3);

  // A change of heart follows the normal re-registration path.
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).resolves.toBe(registrationId);
  registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(registration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  setup = await organizer.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.confirmedRegistrationCount).toBe(4);
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
  const registrationsAfterCut = await listRegistrations(authed, tournamentId);
  const cutPlayerIds = registrationsAfterCut
    .filter(
      ({ registration }) => registration.participationStatus === "eliminated",
    )
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
  const registrationsAfterRewind = await listRegistrations(
    authed,
    tournamentId,
  );
  expect(
    registrationsAfterRewind
      .filter(({ registration }) => cutPlayerIds.includes(registration._id))
      .map(({ registration }) => registration.participationStatus),
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

  const registrationsAfterRejectedCorrection = await listRegistrations(
    authed,
    tournamentId,
  );
  const statusByRegistrationId = new Map(
    registrationsAfterRejectedCorrection.map(({ registration }) => [
      registration._id,
      registration.participationStatus,
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

  const registrations = await listRegistrations(authed, tournamentId);
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
  const registrations = await listRegistrations(authed, tournamentId);
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
  const resetRegistrations = await listRegistrations(authed, tournamentId);
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

// Full registration history, newest first, gathered by walking every page of
// the organizer's paginated endpoint — the tests assert over all rows, not a
// single page.
async function listRegistrations(
  authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  tournamentId: Id<"tournaments">,
) {
  type RegistrationPage = FunctionReturnType<
    typeof api.tournaments.registrations.listRegistrationPage
  >;
  const rows: RegistrationPage["page"] = [];
  let cursor: string | null = null;
  do {
    const result: RegistrationPage = await authed.query(
      api.tournaments.registrations.listRegistrationPage,
      { tournamentId, paginationOpts: { cursor, numItems: 100 } },
    );
    rows.push(...result.page);
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor !== null);
  return rows;
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
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: tournament.confirmedRegistrationCount + count,
    });
  });
}
