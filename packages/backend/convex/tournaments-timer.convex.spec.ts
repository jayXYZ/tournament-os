/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";

import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_ROUND_DURATION_MS,
  MAX_TIMER_ADJUST_MS,
  MIN_ROUND_DURATION_MS,
} from "@tournament-os/shared/timer-utils";

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

const outsiderIdentity = {
  issuer: "https://convex.test",
  subject: "outsider",
  tokenIdentifier: "https://convex.test|outsider",
  email: "outsider@example.test",
  name: "Outsider",
};

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

test("startTimer anchors a running timer to the current round", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  const before = Date.now();
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  const timer = await storedTimer(t, tournamentId);
  const round = await currentRound(t, tournamentId);

  expect(timer?.kind).toBe("running");
  expect(timer?.roundId).toBe(round._id);
  expect(timer?.durationMs).toBe(DEFAULT_ROUND_DURATION_MS);
  if (timer?.kind !== "running") throw new Error("expected running timer");
  expect(timer.startedAt).toBeGreaterThanOrEqual(before);
  expect(timer.endsAt - timer.startedAt).toBe(DEFAULT_ROUND_DURATION_MS);
});

test("startTimer duration falls back from arg to setting to default", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.setRoundDuration, {
    tournamentId,
    durationMs: 40 * 60_000,
  });
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  expect((await storedTimer(t, tournamentId))?.durationMs).toBe(40 * 60_000);

  // An explicit duration wins over the setting; restarting overwrites.
  await organizer.mutation(api.tournaments.timer.startTimer, {
    tournamentId,
    durationMs: 25 * 60_000,
  });
  expect((await storedTimer(t, tournamentId))?.durationMs).toBe(25 * 60_000);

  await expect(
    organizer.mutation(api.tournaments.timer.startTimer, {
      tournamentId,
      durationMs: MIN_ROUND_DURATION_MS - 1,
    }),
  ).rejects.toThrow("Invalid round duration");
});

test("startTimer requires an in-progress round", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await expect(
    organizer.mutation(api.tournaments.timer.startTimer, { tournamentId }),
  ).rejects.toThrow("Tournament is not in progress");

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  // Between rounds: the current round is completed, so nothing is timable.
  await expect(
    organizer.mutation(api.tournaments.timer.startTimer, { tournamentId }),
  ).rejects.toThrow("No round is in progress");
});

test("startTimer requires published pairings", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    { tournamentId, autoPublishPairings: false },
  );
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  await expect(
    organizer.mutation(api.tournaments.timer.startTimer, { tournamentId }),
  ).rejects.toThrow("Pairings have not been published");

  const round = await currentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: round._id,
  });
  await expect(
    organizer.mutation(api.tournaments.timer.startTimer, { tournamentId }),
  ).resolves.toBe(tournamentId);
});

test("pause freezes the remainder and resume re-anchors it", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await expect(
    organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId }),
  ).rejects.toThrow("Timer is not running");
  await expect(
    organizer.mutation(api.tournaments.timer.resumeTimer, { tournamentId }),
  ).rejects.toThrow("Timer is not paused");

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await expect(
    organizer.mutation(api.tournaments.timer.resumeTimer, { tournamentId }),
  ).rejects.toThrow("Timer is not paused");

  await organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId });
  const paused = await storedTimer(t, tournamentId);
  if (paused?.kind !== "paused") throw new Error("expected paused timer");
  expect(paused.remainingMs).toBeGreaterThan(DEFAULT_ROUND_DURATION_MS - 5_000);
  expect(paused.remainingMs).toBeLessThanOrEqual(DEFAULT_ROUND_DURATION_MS);

  const before = Date.now();
  await organizer.mutation(api.tournaments.timer.resumeTimer, { tournamentId });
  const resumed = await storedTimer(t, tournamentId);
  if (resumed?.kind !== "running") throw new Error("expected running timer");
  expect(resumed.endsAt).toBeGreaterThanOrEqual(before + paused.remainingMs);
  expect(resumed.durationMs).toBe(paused.durationMs);
  expect(resumed.startedAt).toBe(paused.startedAt);
});

test("pausing in overtime keeps the negative remainder", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await forceTimerIntoOvertime(t, tournamentId, 10_000);

  await organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId });
  const paused = await storedTimer(t, tournamentId);
  if (paused?.kind !== "paused") throw new Error("expected paused timer");
  expect(paused.remainingMs).toBeLessThanOrEqual(-10_000);
});

test("adjustTimer shifts the anchor and the recorded duration", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await expect(
    organizer.mutation(api.tournaments.timer.adjustTimer, {
      tournamentId,
      deltaMs: 60_000,
    }),
  ).rejects.toThrow("No timer to adjust");

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  const started = await storedTimer(t, tournamentId);
  if (started?.kind !== "running") throw new Error("expected running timer");

  await organizer.mutation(api.tournaments.timer.adjustTimer, {
    tournamentId,
    deltaMs: 5 * 60_000,
  });
  const extended = await storedTimer(t, tournamentId);
  if (extended?.kind !== "running") throw new Error("expected running timer");
  expect(extended.endsAt).toBe(started.endsAt + 5 * 60_000);
  expect(extended.durationMs).toBe(started.durationMs + 5 * 60_000);

  await organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId });
  const paused = await storedTimer(t, tournamentId);
  if (paused?.kind !== "paused") throw new Error("expected paused timer");
  await organizer.mutation(api.tournaments.timer.adjustTimer, {
    tournamentId,
    deltaMs: -60_000,
  });
  const reduced = await storedTimer(t, tournamentId);
  if (reduced?.kind !== "paused") throw new Error("expected paused timer");
  expect(reduced.remainingMs).toBe(paused.remainingMs - 60_000);
  expect(reduced.durationMs).toBe(paused.durationMs - 60_000);

  for (const deltaMs of [0, 1.5, MAX_TIMER_ADJUST_MS + 1]) {
    await expect(
      organizer.mutation(api.tournaments.timer.adjustTimer, {
        tournamentId,
        deltaMs,
      }),
    ).rejects.toThrow("Invalid timer adjustment");
  }
});

test("clearTimer removes the timer and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.clearTimer, { tournamentId });
  expect(await storedTimer(t, tournamentId)).toBeUndefined();

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await organizer.mutation(api.tournaments.timer.clearTimer, { tournamentId });
  expect(await storedTimer(t, tournamentId)).toBeUndefined();
});

test("completeRound clears the finished round's timer", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  expect(await storedTimer(t, tournamentId)).toBeDefined();
  await playOutCurrentRound(t, tournamentId);
  expect(await storedTimer(t, tournamentId)).toBeUndefined();
});

test("cancelTournament clears a live timer", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  expect(await storedTimer(t, tournamentId)).toBeUndefined();
});

test("setRoundDuration validates bounds and rejects cancelled events", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.timer.setRoundDuration, {
    tournamentId,
    durationMs: MAX_ROUND_DURATION_MS,
  });
  const stored = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  expect(stored?.roundDurationMs).toBe(MAX_ROUND_DURATION_MS);

  for (const durationMs of [
    MIN_ROUND_DURATION_MS - 1,
    MAX_ROUND_DURATION_MS + 1,
    90.5,
  ]) {
    await expect(
      organizer.mutation(api.tournaments.timer.setRoundDuration, {
        tournamentId,
        durationMs,
      }),
    ).rejects.toThrow("Invalid round duration");
  }

  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  await expect(
    organizer.mutation(api.tournaments.timer.setRoundDuration, {
      tournamentId,
      durationMs: DEFAULT_ROUND_DURATION_MS,
    }),
  ).rejects.toThrow("Tournament has been cancelled");
});

test("timer mutations reject non-organizers", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);

  const calls = [
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.startTimer, { tournamentId }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.pauseTimer, { tournamentId }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.resumeTimer, { tournamentId }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.adjustTimer, {
          tournamentId,
          deltaMs: 60_000,
        }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.clearTimer, { tournamentId }),
    () =>
      t
        .withIdentity(outsiderIdentity)
        .mutation(api.tournaments.timer.setRoundDuration, {
          tournamentId,
          durationMs: DEFAULT_ROUND_DURATION_MS,
        }),
    // Unauthenticated caller on a representative mutation.
    () => t.mutation(api.tournaments.timer.startTimer, { tournamentId }),
  ];
  for (const call of calls) {
    await expect(call()).rejects.toThrow();
  }
});

test("advance step offers the timer first, then standings once results are in", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  // Fresh pairings with no timer: starting the round timer is the next step.
  let board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({ kind: "startTimer", ready: true });

  // With a live timer the step becomes standings, gated on open matches.
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "generateStandings",
    ready: false,
  });

  // Resetting the timer mid-round re-offers starting it.
  await organizer.mutation(api.tournaments.timer.clearTimer, { tournamentId });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({ kind: "startTimer", ready: true });

  // Every match has a result: standings unblock even though no timer ran.
  await recordAllResults(t, tournamentId);
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "generateStandings",
    ready: true,
  });
});

test("timer state rides along on public and player queries", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.timer.startTimer, { tournamentId });

  const publicCode = await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    return String(tournament!.publicCode);
  });
  const publicView = await t.query(
    api.tournaments.lifecycle.getPublicTournament,
    {
      publicCode,
    },
  );
  expect(publicView?.tournament.roundTimer?.kind).toBe("running");

  const playerView = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(playerView.tournament.roundTimer?.kind).toBe("running");
});

async function storedTimer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  // Read the field outside t.run: its return value is serialized, which would
  // turn a top-level undefined (timer removed) into null.
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  return tournament?.roundTimer;
}

async function forceTimerIntoOvertime(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  overtimeMs: number,
) {
  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const timer = tournament?.roundTimer;
    if (timer?.kind !== "running") {
      throw new Error("Expected a running timer in test setup");
    }
    await ctx.db.patch(tournamentId, {
      roundTimer: { ...timer, endsAt: Date.now() - overtimeMs },
    });
  });
}

async function currentRound(
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

// Records an organizer result for every two-player match in the current round
// without completing it.
async function recordAllResults(
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
  return round;
}

// Records every result and completes the current round, so tests can advance
// rounds without player reports.
async function playOutCurrentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const round = await recordAllResults(t, tournamentId);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.completeRound, { roundId: round._id });
}

async function seedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
) {
  const { organizationId } = await seedOrganizer(t);
  const tournamentId: Id<"tournaments"> = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Timer Test Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.updatePairingsAutoPublish, {
      tournamentId,
      autoPublishPairings: true,
    });

  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"tournamentRegistrations">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: playerNumber + 1,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          status: "active",
          createdAt: now + playerNumber,
          updatedAt: now,
        }),
      );
    }
    return ids;
  });

  return { tournamentId, registrationIds };
}

async function seedStartedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
) {
  const seeded = await seedTournament(t, playerCount);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, {
      tournamentId: seeded.tournamentId,
    });
  return seeded;
}

async function seedOrganizer(t: TestConvex<typeof schema>) {
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
