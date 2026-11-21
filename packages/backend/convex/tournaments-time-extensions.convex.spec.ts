/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { MAX_MATCH_TIME_EXTENSION_MINUTES } from "@paper-pairings/shared/timer-utils";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  currentRound,
  matchForPlayer,
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

const FIVE_MIN = 5 * 60_000;

const staffIdentity = {
  issuer: "https://convex.test",
  subject: "staff",
  tokenIdentifier: "https://convex.test|staff",
  email: "staff@example.test",
  name: "Floor Judge",
};

const outsiderIdentity = {
  issuer: "https://convex.test",
  subject: "outsider",
  tokenIdentifier: "https://convex.test|outsider",
  email: "outsider@example.test",
  name: "Outsider",
};

test("staff set, change, and clear a match's extension, each audited", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
    reason: "  Judge call  ",
  });
  let stored = await storedExtension(t, matchId);
  expect(stored).toMatchObject({
    extensionMs: FIVE_MIN,
    overtimeCreditMs: 0,
    reason: "Judge call",
  });

  // Re-saving the same value is a no-op that logs nothing.
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
    reason: "Judge call",
  });

  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 8,
  });
  stored = await storedExtension(t, matchId);
  expect(stored?.extensionMs).toBe(8 * 60_000);
  expect(stored?.reason).toBeUndefined();

  await organizer.mutation(api.tournaments.timer.clearMatchTimeExtension, {
    matchId,
  });
  expect(await storedExtension(t, matchId)).toBeUndefined();
  // Clearing again is a no-op.
  await organizer.mutation(api.tournaments.timer.clearMatchTimeExtension, {
    matchId,
  });

  const events = await extensionEvents(t, tournamentId);
  expect(
    events.map(({ previousExtensionMs, extensionMs, reason }) => ({
      previousExtensionMs,
      extensionMs,
      reason,
    })),
  ).toEqual([
    { previousExtensionMs: null, extensionMs: FIVE_MIN, reason: "Judge call" },
    { previousExtensionMs: FIVE_MIN, extensionMs: 8 * 60_000, reason: null },
    { previousExtensionMs: 8 * 60_000, extensionMs: null, reason: null },
  ]);
  expect(events[0].players).toHaveLength(2);
  expect(events[0].tableNumber).not.toBeNull();
});

test("only the extended match's players see the extension", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds, matchId } = await seedLiveMatch(t);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 5,
      reason: "Deck check",
    });

  const playersInMatch = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentMatchPlayers")
        .withIndex("by_tournamentMatchId_and_playerId", (q) =>
          q.eq("tournamentMatchId", matchId),
        )
        .take(2)
    ).map((row) => row.playerId),
  );
  for (const [index, registrationId] of registrationIds.entries()) {
    const view = await t
      .withIdentity(playerIdentity(index + 1))
      .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
    if (view.kind !== "match") throw new Error("expected a match view");
    if (playersInMatch.includes(registrationId)) {
      // Only the timer inputs cross to players; the reason stays staff-side.
      expect(view.match.timeExtension).toEqual({
        extensionMs: FIVE_MIN,
        overtimeCreditMs: 0,
      });
    } else {
      expect(view.match.timeExtension).toBeNull();
    }
  }
});

test("an extension granted in overtime credits the overtime already run", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const timer = tournament?.roundTimer;
    if (timer?.kind !== "running") throw new Error("expected running timer");
    await ctx.db.patch(tournamentId, {
      roundTimer: { ...timer, endsAt: Date.now() - 120_000 },
    });
  });

  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
  });
  const granted = await storedExtension(t, matchId);
  expect(granted?.overtimeCreditMs).toBeGreaterThanOrEqual(120_000);
  expect(granted?.overtimeCreditMs).toBeLessThan(130_000);

  // An edit changes the amount but keeps the original anchor.
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 10,
  });
  const edited = await storedExtension(t, matchId);
  expect(edited?.extensionMs).toBe(10 * 60_000);
  expect(edited?.overtimeCreditMs).toBe(granted?.overtimeCreditMs);

  // Restarting the timer starts a clock with no overtime run, so the credit
  // goes and the match is left with its extension alone.
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  expect(await storedExtension(t, matchId)).toMatchObject({
    extensionMs: 10 * 60_000,
    overtimeCreditMs: 0,
  });
  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  if (view.kind !== "match") throw new Error("expected a match view");
  expect(view.match.timeExtension).toEqual({
    extensionMs: 10 * 60_000,
    overtimeCreditMs: 0,
  });
});

test("a first grant while paused in overtime credits the overtime run", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId });
  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const timer = tournament?.roundTimer;
    if (timer?.kind !== "paused") throw new Error("expected paused timer");
    await ctx.db.patch(tournamentId, {
      roundTimer: { ...timer, remainingMs: -90_000 },
    });
  });

  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
  });
  // Paused 1:30 into overtime, so the match holds a full five minutes.
  expect(await storedExtension(t, matchId)).toMatchObject({
    extensionMs: FIVE_MIN,
    overtimeCreditMs: 90_000,
  });
});

test("a save or removal from a stale form is refused", async () => {
  const t = createConvexTest();
  const { matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);
  const stale = "was just changed by someone else";

  // One judge opens the +5 grant; another raises it to +10 meanwhile.
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
    expectedSetAt: null,
  });
  const opened = await storedExtension(t, matchId);
  if (!opened) throw new Error("expected an extension");
  await t.run(async (ctx) => {
    await ctx.db.patch(matchId, {
      timeExtension: {
        ...opened,
        extensionMs: 10 * 60_000,
        setAt: opened.setAt + 1,
      },
    });
  });

  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 5,
      reason: "Deck check",
      expectedSetAt: opened.setAt,
    }),
  ).rejects.toThrow(stale);
  await expect(
    organizer.mutation(api.tournaments.timer.clearMatchTimeExtension, {
      matchId,
      expectedSetAt: opened.setAt,
    }),
  ).rejects.toThrow(stale);
  // A form opened before any grant existed is stale too.
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 3,
      expectedSetAt: null,
    }),
  ).rejects.toThrow(stale);
  expect((await storedExtension(t, matchId))?.extensionMs).toBe(10 * 60_000);

  // The current value's setAt is accepted.
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 12,
    expectedSetAt: opened.setAt + 1,
  });
  expect((await storedExtension(t, matchId))?.extensionMs).toBe(12 * 60_000);
});

test("extensions can be granted before the timer starts and while it is paused", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 3,
  });
  expect((await storedExtension(t, matchId))?.overtimeCreditMs).toBe(0);

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId });
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 4,
  });
  expect(await storedExtension(t, matchId)).toMatchObject({
    extensionMs: 4 * 60_000,
    overtimeCreditMs: 0,
  });
});

test("setMatchTimeExtension validates the minutes and reason", async () => {
  const t = createConvexTest();
  const { matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);

  for (const minutes of [0, -5, 2.5, MAX_MATCH_TIME_EXTENSION_MINUTES + 1]) {
    await expect(
      organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
        matchId,
        minutes,
      }),
    ).rejects.toThrow("Time extensions must be whole minutes");
  }
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 5,
      reason: "x".repeat(201),
    }),
  ).rejects.toThrow("Extension reason must be at most 200 characters");
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: MAX_MATCH_TIME_EXTENSION_MINUTES,
    }),
  ).resolves.toBe(matchId);
});

test("finished matches refuse a new extension but can drop an existing one", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId,
    minutes: 5,
  });
  const players = await t.run(async (ctx) =>
    ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2),
  );
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId,
    playerOneRegistrationId: players[0].playerId,
    playerTwoRegistrationId: players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });

  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 7,
    }),
  ).rejects.toThrow("This match is already finished");

  // The grant stays on record for staff, but the finished match's players
  // are back on the round clock.
  expect((await storedExtension(t, matchId))?.extensionMs).toBe(FIVE_MIN);
  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  if (view.kind !== "match") throw new Error("expected a match view");
  expect(view.match.timeExtension).toBeNull();

  await organizer.mutation(api.tournaments.timer.clearMatchTimeExtension, {
    matchId,
  });
  expect(await storedExtension(t, matchId)).toBeUndefined();
});

test("byes and past rounds cannot be extended, nor a past extension removed", async () => {
  const t = createConvexTest();
  // Five players: one gets a bye.
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Extension Bye Event",
    playerCount: 5,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const round = await currentRound(t, tournamentId);
  const matches = await t.run(async (ctx) =>
    ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", round._id),
      )
      .collect(),
  );
  const bye = matches.find((match) => match.tableNumber === undefined);
  const played = matches.find((match) => match.tableNumber !== undefined);
  if (!bye || !played) throw new Error("expected a bye and a played match");

  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId: bye._id,
      minutes: 5,
    }),
  ).rejects.toThrow("A bye has no match time to extend");

  // Once the round is over, its matches are no longer extendable and an
  // extension they carry can no longer be removed.
  await organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
    matchId: played._id,
    minutes: 5,
  });
  await playOutCurrentRound(t, tournamentId);
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId: played._id,
      minutes: 5,
    }),
  ).rejects.toThrow("No round is in progress");
  await expect(
    organizer.mutation(api.tournaments.timer.clearMatchTimeExtension, {
      matchId: played._id,
    }),
  ).rejects.toThrow("No round is in progress");
  expect((await storedExtension(t, played._id))?.extensionMs).toBe(FIVE_MIN);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId: played._id,
      minutes: 5,
    }),
  ).rejects.toThrow("Only matches in the current round can be extended");
});

test("held pairings cannot be extended until published", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Extension Held Event",
    playerCount: 4,
    autoPublishPairings: false,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  await expect(
    organizer.mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId: match._id,
      minutes: 5,
    }),
  ).rejects.toThrow("Pairings have not been published");
});

test("any active staff member can extend; players and outsiders cannot", async () => {
  const t = createConvexTest();
  const { tournamentId, matchId } = await seedLiveMatch(t);
  await seedStaffMember(t, tournamentId);

  await t
    .withIdentity(staffIdentity)
    .mutation(api.tournaments.timer.setMatchTimeExtension, {
      matchId,
      minutes: 5,
    });
  const staffUserId = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", staffIdentity.tokenIdentifier),
      )
      .unique()
      .then((user) => user!._id),
  );
  expect((await storedExtension(t, matchId))?.setByUserId).toBe(staffUserId);

  // Player 1 sits in this very match; then an outsider and an anonymous
  // caller.
  const playerNumber = 1;
  const calls = [
    () =>
      t
        .withIdentity(playerIdentity(playerNumber))
        .mutation(api.tournaments.timer.setMatchTimeExtension, {
          matchId,
          minutes: 10,
        }),
    () =>
      t
        .withIdentity(playerIdentity(playerNumber))
        .mutation(api.tournaments.timer.clearMatchTimeExtension, { matchId }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.setMatchTimeExtension, {
          matchId,
          minutes: 10,
        }),
    () =>
      t.mutation(api.tournaments.timer.clearMatchTimeExtension, { matchId }),
  ];
  for (const call of calls) {
    await expect(call()).rejects.toThrow(/Unauthorized|Not authenticated/);
  }
  expect((await storedExtension(t, matchId))?.extensionMs).toBe(FIVE_MIN);
});

// A started four-player tournament with published round-1 pairings, and the
// match player 1 sits in.
async function seedLiveMatch(t: TestConvex<typeof schema>) {
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Extension Event",
    playerCount: 4,
  });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  return { tournamentId, registrationIds, matchId: match._id };
}

async function seedStaffMember(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: staffIdentity.tokenIdentifier,
      publicCode: 900,
      email: staffIdentity.email,
      name: staffIdentity.name,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId: tournament!.organizationId,
      userId,
      email: staffIdentity.email,
      role: "staff",
      status: "active",
      updatedAt: now,
    });
  });
}

async function storedExtension(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
) {
  const match = await t.run(async (ctx) => await ctx.db.get(matchId));
  return match?.timeExtension;
}

async function extensionEvents(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .collect(),
  );
  return rows.flatMap((row) =>
    row.event.type === "match_time_extension_changed" ? [row.event] : [],
  );
}
