/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_PROFILE_RESULTS_PAGE_SIZE } from "./model/playerResults";
import { START_DATE_SYNC_BATCH_SIZE } from "./model/registrations";
import schema from "./schema";
import {
  organizerIdentity,
  playOutCurrentRound,
  seedOrganizer,
} from "./specHelpers";

const modules = import.meta.glob("./**/*.ts");

// Manually seeded users get codes far above the allocation counter (which
// starts at 1) so mutations that upsert a fresh user never collide with them.
const ORGANIZER_PUBLIC_CODE = 1000;

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

function playerPublicCode(playerNumber: number) {
  return String(100 + playerNumber);
}

// Accepts both the anonymous accessor and one bound via withIdentity (which
// returns the narrower TestConvexForDataModel); only .query is needed here.
async function playerResultsPage(
  t: Pick<TestConvex<typeof schema>, "query">,
  publicCode: string,
  paginationOpts: { numItems: number; cursor: string | null } = {
    numItems: 100,
    cursor: null,
  },
) {
  return await t.query(api.users.getPublicPlayerResults, {
    publicCode,
    paginationOpts,
  });
}

test("updateMyProfileSettings persists visibility fields independently", async () => {
  const t = convexTest(schema, modules);
  const player = t.withIdentity(playerIdentity(1));

  await expect(
    t.mutation(api.users.updateMyProfileSettings, {
      profileVisibility: "private",
    }),
  ).rejects.toThrow("Not authenticated");

  await player.mutation(api.users.upsertMe, {});
  let me = await player.query(api.users.me, {});
  expect(me?.profileVisibility).toBe("public");
  expect(me?.historyVisibility).toBe("public");

  await player.mutation(api.users.updateMyProfileSettings, {
    historyVisibility: "private",
  });
  me = await player.query(api.users.me, {});
  expect(me?.profileVisibility).toBe("public");
  expect(me?.historyVisibility).toBe("private");

  await player.mutation(api.users.updateMyProfileSettings, {
    profileVisibility: "private",
  });
  me = await player.query(api.users.me, {});
  expect(me?.profileVisibility).toBe("private");
  expect(me?.historyVisibility).toBe("private");

  // A later sign-in sync must not clobber saved settings.
  await player.mutation(api.users.upsertMe, {});
  me = await player.query(api.users.me, {});
  expect(me?.profileVisibility).toBe("private");
  expect(me?.historyVisibility).toBe("private");
});

test("getPublicPlayer hides private profiles from everyone but their owner", async () => {
  const t = convexTest(schema, modules);
  await seedUsers(t, 1);
  const publicCode = playerPublicCode(1);
  const owner = t.withIdentity(playerIdentity(1));

  expect(await t.query(api.users.getPublicPlayer, { publicCode: "abc" })).toBe(
    null,
  );
  expect(
    await t.query(api.users.getPublicPlayer, { publicCode: "999999" }),
  ).toBe(null);

  const anonymousView = await t.query(api.users.getPublicPlayer, {
    publicCode,
  });
  expect(anonymousView).toMatchObject({
    publicCode: 101,
    name: "Player 1",
    isOwner: false,
    profileHidden: false,
    historyVisible: true,
  });

  await owner.mutation(api.users.updateMyProfileSettings, {
    historyVisibility: "private",
  });
  expect(
    await t.query(api.users.getPublicPlayer, { publicCode }),
  ).toMatchObject({ historyVisible: false, historyHidden: true });
  expect(
    await owner.query(api.users.getPublicPlayer, { publicCode }),
  ).toMatchObject({ isOwner: true, historyVisible: true, historyHidden: true });

  await owner.mutation(api.users.updateMyProfileSettings, {
    profileVisibility: "private",
  });
  expect(await t.query(api.users.getPublicPlayer, { publicCode })).toBe(null);
  expect(
    await owner.query(api.users.getPublicPlayer, { publicCode }),
  ).toMatchObject({ isOwner: true, profileHidden: true });
});

test("getPublicPlayerResults returns completed results matching final standings", async () => {
  const t = convexTest(schema, modules);
  // Five players so the lowest seed takes a bye alongside real pairings.
  const seeded = await seedCompletedTournament(t, 5);
  const publicCode = playerPublicCode(1);

  const standing = await finalStandingRow(
    t,
    seeded.tournamentId,
    seeded.registrationIds[0],
  );
  const results = (await playerResultsPage(t, publicCode)).page;
  expect(results).toHaveLength(1);
  expect(results?.[0]).toMatchObject({
    tournamentId: seeded.tournamentId,
    tournamentName: "Profile Event",
    registrationStatus: "active",
    finalRank: standing.rank,
    matchPoints: standing.matchPoints,
    matchWins: standing.matchWins,
    matchLosses: standing.matchLosses,
    matchDraws: standing.matchDraws,
  });

  // A tournament still in progress stays out of the history.
  await seedInProgressTournament(t, seeded.userIds, seeded.organizationId);
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(1);

  // Test events never surface, whatever their lifecycle.
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.tournamentId, { isTestEvent: true });
  });
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.tournamentId, { isTestEvent: false });
  });

  // A cancelled entry means the player never actually took part.
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.registrationIds[0], {
      entryStatus: "cancelled",
      participationStatus: undefined,
    });
  });
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.registrationIds[0], {
      entryStatus: "confirmed",
      participationStatus: "dropped",
    });
  });

  // A dropped player's completed tournament remains public record.
  const droppedResults = (await playerResultsPage(t, publicCode)).page;
  expect(droppedResults).toHaveLength(1);
  expect(droppedResults?.[0].registrationStatus).toBe("dropped");

  // Public/player-facing history must not reveal an organizer DQ. It is
  // intentionally indistinguishable from a voluntary drop at this boundary.
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.registrationIds[0], {
      participationStatus: "disqualified",
    });
  });
  const disqualifiedResults = (await playerResultsPage(t, publicCode)).page;
  expect(disqualifiedResults).toHaveLength(1);
  expect(disqualifiedResults?.[0].registrationStatus).toBe("dropped");

  // A player with no qualifying events gets an empty list, not null.
  const stranger = t.withIdentity(playerIdentity(99));
  await stranger.mutation(api.users.upsertMe, {});
  const strangerCode = String(
    (await stranger.query(api.users.me, {}))!.publicCode,
  );
  expect((await playerResultsPage(t, strangerCode)).page).toHaveLength(0);
});

test("getPublicPlayerResults paginates completed tournaments newest first", async () => {
  const t = convexTest(schema, modules);
  const { organizationId, userId: organizerId } = await seedOrganizer(
    t,
    ORGANIZER_PUBLIC_CODE,
  );
  const [userId] = await seedUsers(t, 1);
  const now = Date.now();
  const events = [
    { name: "Oldest Event", startDate: now - 30_000 },
    { name: "Newest Event", startDate: now - 10_000 },
    { name: "Middle Event", startDate: now - 20_000 },
  ];

  await t.run(async (ctx) => {
    for (const [index, event] of events.entries()) {
      const tournamentId = await ctx.db.insert("tournaments", {
        name: event.name,
        publicCode: 2_000 + index,
        organizationId,
        createdBy: organizerId,
        visibility: "public",
        lifecycle: "completed",
        startDate: event.startDate,
        playerCapacity: 16,
        format: "standard",
        isTestEvent: false,
        autoPublishPairings: false,
        confirmedRegistrationCount: 1,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: event.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  const firstPage = await playerResultsPage(t, playerPublicCode(1), {
    numItems: 2,
    cursor: null,
  });
  expect(firstPage.page.map((result) => result.tournamentName)).toEqual([
    "Newest Event",
    "Middle Event",
  ]);
  expect(firstPage.isDone).toBe(false);

  const secondPage = await playerResultsPage(t, playerPublicCode(1), {
    numItems: 2,
    cursor: firstPage.continueCursor,
  });
  expect(secondPage.page.map((result) => result.tournamentName)).toEqual([
    "Oldest Event",
  ]);
  expect(secondPage.isDone).toBe(true);
});

test("getPublicPlayerResults bounds hostile and non-finite page sizes", async () => {
  const t = convexTest(schema, modules);
  const { organizationId, userId: organizerId } = await seedOrganizer(
    t,
    ORGANIZER_PUBLIC_CODE,
  );
  const [userId] = await seedUsers(t, 1);
  const now = Date.now();
  const totalRows = MAX_PROFILE_RESULTS_PAGE_SIZE + 1;

  await t.run(async (ctx) => {
    for (let index = 0; index < totalRows; index += 1) {
      const startDate = now - index * 1_000;
      const tournamentId = await ctx.db.insert("tournaments", {
        name: `Bounded Event ${index}`,
        publicCode: 8_000 + index,
        organizationId,
        createdBy: organizerId,
        visibility: "public",
        lifecycle: "completed",
        startDate,
        playerCapacity: 64,
        format: "standard",
        isTestEvent: false,
        autoPublishPairings: false,
        confirmedRegistrationCount: 1,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  const oversized = await playerResultsPage(t, playerPublicCode(1), {
    numItems: Number.MAX_SAFE_INTEGER,
    cursor: null,
  });
  expect(oversized.page).toHaveLength(MAX_PROFILE_RESULTS_PAGE_SIZE);
  expect(oversized.isDone).toBe(false);

  const remainder = await playerResultsPage(t, playerPublicCode(1), {
    numItems: Number.MAX_SAFE_INTEGER,
    cursor: oversized.continueCursor,
  });
  expect(remainder.page).toHaveLength(1);
  expect(remainder.isDone).toBe(true);

  for (const numItems of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const nonFinite = await playerResultsPage(t, playerPublicCode(1), {
      numItems,
      cursor: null,
    });
    expect(nonFinite.page).toHaveLength(1);
    expect(nonFinite.isDone).toBe(false);
  }
});

// Same-day tournaments share the index's tournamentStartDate component, so a
// page boundary inside the same-day group relies on the paginate cursor's
// _creationTime tie-break — entries must neither skip nor repeat across it.
test("getPublicPlayerResults pages through tournaments sharing a start date", async () => {
  const t = convexTest(schema, modules);
  const { organizationId, userId: organizerId } = await seedOrganizer(
    t,
    ORGANIZER_PUBLIC_CODE,
  );
  const [userId] = await seedUsers(t, 1);
  const now = Date.now();
  const events = [
    { name: "Solo Newest Event", startDate: now - 10_000 },
    // Inserted in this order, so descending _creationTime lists C, B, A.
    { name: "Same Day Event A", startDate: now - 20_000 },
    { name: "Same Day Event B", startDate: now - 20_000 },
    { name: "Same Day Event C", startDate: now - 20_000 },
    { name: "Solo Oldest Event", startDate: now - 30_000 },
  ];

  await t.run(async (ctx) => {
    for (const [index, event] of events.entries()) {
      const tournamentId = await ctx.db.insert("tournaments", {
        name: event.name,
        publicCode: 5_000 + index,
        organizationId,
        createdBy: organizerId,
        visibility: "public",
        lifecycle: "completed",
        startDate: event.startDate,
        playerCapacity: 16,
        format: "standard",
        isTestEvent: false,
        autoPublishPairings: false,
        confirmedRegistrationCount: 1,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: event.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  const pages: string[][] = [];
  let cursor: string | null = null;
  for (let requests = 0; requests < events.length; requests += 1) {
    const page = await playerResultsPage(t, playerPublicCode(1), {
      numItems: 2,
      cursor,
    });
    pages.push(page.page.map((result) => result.tournamentName));
    if (page.isDone) {
      break;
    }
    cursor = page.continueCursor;
  }
  expect(pages).toEqual([
    ["Solo Newest Event", "Same Day Event C"],
    ["Same Day Event B", "Same Day Event A"],
    ["Solo Oldest Event"],
  ]);
});

// Visibility filters each page AFTER pagination, so a page whose index rows
// are all hidden comes back short or empty (with isDone: false) rather than
// topped up — usePaginatedQuery keeps paging through short pages, and the
// opaque system cursor reveals nothing about the hidden rows it crossed.
test("getPublicPlayerResults filters hidden registrations out of every page", async () => {
  const t = convexTest(schema, modules);
  const { organizationId, userId: organizerId } = await seedOrganizer(
    t,
    ORGANIZER_PUBLIC_CODE,
  );
  const [userId] = await seedUsers(t, 1);
  const now = Date.now();
  const events = [
    {
      name: "Newest Visible Event",
      startDate: now - 10_000,
      visibility: "public" as const,
      lifecycle: "completed" as const,
    },
    {
      name: "Hidden Private Event",
      startDate: now - 20_000,
      visibility: "private" as const,
      lifecycle: "completed" as const,
    },
    {
      name: "Hidden In-progress Event",
      startDate: now - 30_000,
      visibility: "public" as const,
      lifecycle: "in_progress" as const,
    },
    {
      name: "Oldest Visible Event",
      startDate: now - 40_000,
      visibility: "public" as const,
      lifecycle: "completed" as const,
    },
  ];

  await t.run(async (ctx) => {
    for (const [index, event] of events.entries()) {
      const tournamentId = await ctx.db.insert("tournaments", {
        name: event.name,
        publicCode: 3_000 + index,
        organizationId,
        createdBy: organizerId,
        visibility: event.visibility,
        lifecycle: event.lifecycle,
        startDate: event.startDate,
        playerCapacity: 16,
        format: "standard",
        isTestEvent: false,
        autoPublishPairings: false,
        confirmedRegistrationCount: 1,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: event.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  const seen: string[] = [];
  let cursor: string | null = null;
  let isDone = false;
  for (let requests = 0; requests <= events.length && !isDone; requests += 1) {
    const page = await playerResultsPage(t, playerPublicCode(1), {
      numItems: 1,
      cursor,
    });
    seen.push(...page.page.map((result) => result.tournamentName));
    cursor = page.continueCursor;
    isDone = page.isDone;
  }
  expect(isDone).toBe(true);
  expect(seen).toEqual(["Newest Visible Event", "Oldest Visible Event"]);
});

test("getPublicPlayerResults exhausts an entirely hidden history in one page", async () => {
  const t = convexTest(schema, modules);
  const { organizationId, userId: organizerId } = await seedOrganizer(
    t,
    ORGANIZER_PUBLIC_CODE,
  );
  const [userId] = await seedUsers(t, 1);
  const now = Date.now();
  await t.run(async (ctx) => {
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Hidden Event",
      publicCode: 4_000,
      organizationId,
      createdBy: organizerId,
      visibility: "private",
      lifecycle: "completed",
      startDate: now,
      playerCapacity: 16,
      format: "standard",
      isTestEvent: false,
      autoPublishPairings: false,
      confirmedRegistrationCount: 1,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId,
      tournamentStartDate: now,
      entryStatus: "confirmed",
      participationStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  const page = await playerResultsPage(t, playerPublicCode(1), {
    numItems: 1,
    cursor: null,
  });
  expect(page).toMatchObject({ page: [], isDone: true });
});

test("tournament date edits keep registration history ordering synchronized", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t, ORGANIZER_PUBLIC_CODE);
  const organizer = t.withIdentity(organizerIdentity);
  const originalStartDate = Date.now() + 60_000;
  const updatedStartDate = originalStartDate + 60_000;
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournament,
    {
      organizationId,
      name: "Rescheduled Event",
      startDate: originalStartDate,
      playerCapacity: 16,
      format: "standard",
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    startDate: updatedStartDate,
  });

  const registration = await t.run(async (ctx) => {
    return await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .unique();
  });
  expect(registration?.tournamentStartDate).toBe(updatedStartDate);
});

// A reschedule on an event whose registration rows exceed one transaction's
// write budget syncs one batch inline and drains the rest through scheduled
// continuations — cancelled churn rows included, since the history index
// covers every entryStatus.
test("start date edits drain oversized registration sets via scheduled batches", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t, ORGANIZER_PUBLIC_CODE);
  const organizer = t.withIdentity(organizerIdentity);
  const originalStartDate = Date.now() + 60_000;
  const updatedStartDate = originalStartDate + 60_000;
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournament,
    {
      organizationId,
      name: "Oversized Reschedule",
      startDate: originalStartDate,
      playerCapacity: 16,
      format: "standard",
    },
  );

  // Enough rows that even the first scheduled continuation cannot finish, so
  // the chain must reschedule itself at least once.
  const totalRows = START_DATE_SYNC_BATCH_SIZE * 2 + 8;
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < totalRows; index += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `https://convex.test|churn-${index}`,
        publicCode: 10_000 + index,
        email: `churn${index}@example.test`,
        name: `Churn ${index}`,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: originalStartDate,
        ...(index % 2 === 0
          ? {
              entryStatus: "confirmed" as const,
              participationStatus: "active" as const,
            }
          : { entryStatus: "cancelled" as const }),
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  const countSynced = async () =>
    await t.run(async (ctx) => {
      let synced = 0;
      let total = 0;
      const rows = ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
          q.eq("tournamentId", tournamentId),
        );
      for await (const row of rows) {
        total += 1;
        if (row.tournamentStartDate === updatedStartDate) {
          synced += 1;
        }
      }
      return { synced, total };
    });

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    startDate: updatedStartDate,
  });

  // The mutation itself stays within one write budget: the tournament document
  // (the source of truth) already carries the new date while registrations
  // beyond the first batch still hold the old copy.
  const during = await countSynced();
  expect(during.total).toBe(totalRows);
  expect(during.synced).toBe(START_DATE_SYNC_BATCH_SIZE);
  const tournamentDuring = await t.run(
    async (ctx) => await ctx.db.get(tournamentId),
  );
  expect(tournamentDuring?.startDate).toBe(updatedStartDate);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();

  const after = await countSynced();
  expect(after.total).toBe(totalRows);
  expect(after.synced).toBe(totalRows);
});

// A second reschedule arriving while the first one's sync chain is still
// draining must not strand rows on the superseded date: every batch
// recomputes staleness against the tournament's current startDate, so rows
// already synced to the first target become stale again and all chains
// converge on the latest value.
test("a reschedule during an in-flight sync converges on the latest date", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t, ORGANIZER_PUBLIC_CODE);
  const organizer = t.withIdentity(organizerIdentity);
  const originalStartDate = Date.now() + 60_000;
  const supersededStartDate = originalStartDate + 60_000;
  const latestStartDate = supersededStartDate + 60_000;
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournament,
    {
      organizationId,
      name: "Twice-Rescheduled Event",
      startDate: originalStartDate,
      playerCapacity: 16,
      format: "standard",
    },
  );

  // More rows than one batch so the first reschedule leaves a chain pending.
  const totalRows = START_DATE_SYNC_BATCH_SIZE + 8;
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < totalRows; index += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `https://convex.test|retarget-${index}`,
        publicCode: 20_000 + index,
        email: `retarget${index}@example.test`,
        name: `Retarget ${index}`,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        tournamentStartDate: originalStartDate,
        entryStatus: "confirmed" as const,
        participationStatus: "active" as const,
        createdAt: now + index,
        updatedAt: now,
      });
    }
  });

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    startDate: supersededStartDate,
  });
  // Retarget before the scheduled continuation runs: some rows now carry the
  // superseded date, the rest still the original.
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    startDate: latestStartDate,
  });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();

  const after = await t.run(async (ctx) => {
    let total = 0;
    let onLatest = 0;
    const rows = ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      );
    for await (const row of rows) {
      total += 1;
      if (row.tournamentStartDate === latestStartDate) {
        onLatest += 1;
      }
    }
    return { total, onLatest };
  });
  expect(after).toEqual({ total: totalRows, onLatest: totalRows });
});

// Regression: a player who drops mid-tournament has no live match in later
// rounds, but the final standings must still carry their frozen record —
// their profile shows the real result, not an unranked 0-0-0.
test("a mid-tournament drop keeps the player's final record and rank", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t, ORGANIZER_PUBLIC_CODE);
  const userIds = await seedUsers(t, 4);
  const { tournamentId, registrationIds } = await createStartedTournament(
    t,
    organizationId,
    userIds,
    "Drop Event",
  );

  // Record every result, then drop player 1 before the round completes so
  // the round-final standings are computed while they are already dropped.
  const organizer = t.withIdentity(organizerIdentity);
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
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
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[0],
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round!._id,
  });
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  const standing = await finalStandingRow(t, tournamentId, registrationIds[0]);
  const results = (await playerResultsPage(t, playerPublicCode(1))).page;
  expect(results).toHaveLength(1);
  expect(results?.[0]).toMatchObject({
    registrationStatus: "dropped",
    finalRank: standing.rank,
    matchPoints: standing.matchPoints,
    matchWins: standing.matchWins,
    matchLosses: standing.matchLosses,
    matchDraws: standing.matchDraws,
  });
  // The record is the one they actually played, not an empty fallback.
  expect(standing.matchWins + standing.matchLosses + standing.matchDraws).toBe(
    1,
  );
});

test("getPublicPlayerResults hides history per settings but never from the owner", async () => {
  const t = convexTest(schema, modules);
  await seedCompletedTournament(t, 4);
  const publicCode = playerPublicCode(1);
  const owner = t.withIdentity(playerIdentity(1));

  await owner.mutation(api.users.updateMyProfileSettings, {
    historyVisibility: "private",
  });
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);
  expect((await playerResultsPage(owner, publicCode)).page).toHaveLength(1);

  await owner.mutation(api.users.updateMyProfileSettings, {
    profileVisibility: "private",
    historyVisibility: "public",
  });
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);
  expect((await playerResultsPage(owner, publicCode)).page).toHaveLength(1);
});

test("private tournaments appear only for viewers with their own access", async () => {
  const t = convexTest(schema, modules);
  const seeded = await seedCompletedTournament(t, 4);
  const publicCode = playerPublicCode(1);
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.tournamentId, { visibility: "private" });
  });

  // Anonymous viewers see a public profile with no visible events.
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);

  // The player still sees their own private tournament.
  expect(
    (await playerResultsPage(t.withIdentity(playerIdentity(1)), publicCode))
      .page,
  ).toHaveLength(1);

  // A co-participant carries their own registration-based access.
  expect(
    (await playerResultsPage(t.withIdentity(playerIdentity(2)), publicCode))
      .page,
  ).toHaveLength(1);

  // An organizing-org member sees it through their membership.
  expect(
    (await playerResultsPage(t.withIdentity(organizerIdentity), publicCode))
      .page,
  ).toHaveLength(1);

  // A signed-in stranger gets no more than the anonymous viewer.
  const stranger = t.withIdentity(playerIdentity(99));
  await stranger.mutation(api.users.upsertMe, {});
  expect((await playerResultsPage(stranger, publicCode)).page).toHaveLength(0);
});

// Unlisted events are link-only; a profile listing naming them would hand out
// the link they hide behind, so they gate exactly like private ones here.
test("unlisted tournaments appear only for viewers with their own access", async () => {
  const t = convexTest(schema, modules);
  const seeded = await seedCompletedTournament(t, 4);
  const publicCode = playerPublicCode(1);
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.tournamentId, { visibility: "unlisted" });
  });

  // Anonymous viewers and signed-in strangers see no trace of the event.
  expect((await playerResultsPage(t, publicCode)).page).toHaveLength(0);
  const stranger = t.withIdentity(playerIdentity(99));
  await stranger.mutation(api.users.upsertMe, {});
  expect((await playerResultsPage(stranger, publicCode)).page).toHaveLength(0);

  // Participants and organizing-org members keep their own access.
  expect(
    (await playerResultsPage(t.withIdentity(playerIdentity(2)), publicCode))
      .page,
  ).toHaveLength(1);
  expect(
    (await playerResultsPage(t.withIdentity(organizerIdentity), publicCode))
      .page,
  ).toHaveLength(1);

  // The per-tournament log honors the same gate.
  expect(
    await t.query(api.users.getPublicPlayerTournamentLog, {
      publicCode,
      tournamentId: seeded.tournamentId,
    }),
  ).toBe(null);
  expect(
    await t
      .withIdentity(playerIdentity(1))
      .query(api.users.getPublicPlayerTournamentLog, {
        publicCode,
        tournamentId: seeded.tournamentId,
      }),
  ).toHaveLength(1);
});

test("getPublicPlayerTournamentLog returns the round log and re-runs the privacy gate", async () => {
  const t = convexTest(schema, modules);
  const seeded = await seedCompletedTournament(t, 5);
  const publicCode = playerPublicCode(1);

  const log = await t.query(api.users.getPublicPlayerTournamentLog, {
    publicCode,
    tournamentId: seeded.tournamentId,
  });
  expect(log).toHaveLength(1);
  expect(log?.[0].roundNumber).toBe(1);
  expect(log?.[0].isBye).toBe(false);
  expect(log?.[0].opponentName).toMatch(/^Player \d$/);
  expect(["win", "loss"]).toContain(log?.[0].result);

  // The lowest seed (player 5) took the round-one bye.
  const byeLog = await t.query(api.users.getPublicPlayerTournamentLog, {
    publicCode: playerPublicCode(5),
    tournamentId: seeded.tournamentId,
  });
  expect(byeLog?.[0]).toMatchObject({ isBye: true, result: "win" });

  // An in-progress tournament exposes no log even though pairings exist.
  const inProgress = await seedInProgressTournament(
    t,
    seeded.userIds,
    seeded.organizationId,
  );
  expect(
    await t.query(api.users.getPublicPlayerTournamentLog, {
      publicCode,
      tournamentId: inProgress.tournamentId,
    }),
  ).toBe(null);

  // A profile with no registration in the tournament has no log (the
  // organizer's profile is public but they never played).
  expect(
    await t.query(api.users.getPublicPlayerTournamentLog, {
      publicCode: String(ORGANIZER_PUBLIC_CODE),
      tournamentId: seeded.tournamentId,
    }),
  ).toBe(null);

  // Hiding history hides the log behind the same gate.
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.users.updateMyProfileSettings, {
      historyVisibility: "private",
    });
  expect(
    await t.query(api.users.getPublicPlayerTournamentLog, {
      publicCode,
      tournamentId: seeded.tournamentId,
    }),
  ).toBe(null);
  expect(
    await t
      .withIdentity(playerIdentity(1))
      .query(api.users.getPublicPlayerTournamentLog, {
        publicCode,
        tournamentId: seeded.tournamentId,
      }),
  ).toHaveLength(1);
});

async function seedUsers(t: TestConvex<typeof schema>, playerCount: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userIds: Id<"users">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      userIds.push(
        await ctx.db.insert("users", {
          tokenIdentifier: identity.tokenIdentifier,
          publicCode: Number(playerPublicCode(playerNumber)),
          email: identity.email,
          name: identity.name,
          updatedAt: now,
        }),
      );
    }
    return userIds;
  });
}

async function registerUsers(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  userIds: Id<"users">[],
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const ids: Id<"tournamentRegistrations">[] = [];
    for (const [index, userId] of userIds.entries()) {
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          createdAt: now + index + 1,
          updatedAt: now,
        }),
      );
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount:
        tournament.confirmedRegistrationCount + userIds.length,
      updatedAt: now,
    });
    return ids;
  });
}

async function createStartedTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  userIds: Id<"users">[],
  name: string,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name,
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    {
      tournamentId,
      autoPublishPairings: true,
    },
  );
  const registrationIds = await registerUsers(t, tournamentId, userIds);
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  return { tournamentId, registrationIds };
}

async function seedInProgressTournament(
  t: TestConvex<typeof schema>,
  userIds: Id<"users">[],
  organizationId: Id<"organizations">,
) {
  return await createStartedTournament(
    t,
    organizationId,
    userIds,
    "In Progress Event",
  );
}

// A real completed event: one fixed Swiss round played out with organizer
// results, then the tournament is completed through the public mutation.
async function seedCompletedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
) {
  const { organizationId } = await seedOrganizer(t, ORGANIZER_PUBLIC_CODE);
  const userIds = await seedUsers(t, playerCount);
  const { tournamentId, registrationIds } = await createStartedTournament(
    t,
    organizationId,
    userIds,
    "Profile Event",
  );
  await playOutCurrentRound(t, tournamentId);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.completeTournament, { tournamentId });
  return { tournamentId, registrationIds, userIds, organizationId };
}

async function finalStandingRow(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
): Promise<Doc<"roundStandings">> {
  return await t.run(async (ctx) => {
    const phase = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
      )
      .unique();
    const round = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q.eq("tournamentPhaseId", phase!._id).eq("roundNumber", 1),
      )
      .unique();
    const standing = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_playerId", (q) =>
        q.eq("tournamentRoundId", round!._id).eq("playerId", registrationId),
      )
      .unique();
    if (!standing) {
      throw new Error("Final standing missing in test setup");
    }
    return standing;
  });
}
