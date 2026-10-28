/// <reference types="vite/client" />

import { expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  insertLinkedParticipant,
  organizerIdentity,
  rawSeed,
  seedOrganizer,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

async function countTournamentRows(
  t: ReturnType<typeof createConvexTest>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const phases = await ctx.db.query("tournamentPhases").collect();
    const rounds = await ctx.db.query("tournamentRounds").collect();
    const matches = await ctx.db.query("tournamentMatches").collect();
    const matchPlayers = await ctx.db.query("tournamentMatchPlayers").collect();
    const standings = await ctx.db.query("roundStandings").collect();
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .collect();
    const testPlayers = await ctx.db.query("testTournamentPlayers").collect();
    const configs = await ctx.db.query("tournamentTestConfigs").collect();
    return {
      tournament: await ctx.db.get(tournamentId),
      total:
        phases.length +
        rounds.length +
        matches.length +
        matchPlayers.length +
        standings.length +
        registrations.length +
        testPlayers.length +
        configs.length,
    };
  });
}

test("deleteTournament removes a small event and all child rows in one transaction", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Small Delete Check",
      dummyPlayerCount: 4,
      roundsToGenerate: 2,
      seed: 11,
      autoStart: true,
    },
  );

  const before = await countTournamentRows(t, tournamentId);
  expect(before.tournament).not.toBeNull();
  expect(before.total).toBeGreaterThan(0);

  await authed.mutation(api.tournaments.lifecycle.deleteTournament, {
    tournamentId,
  });

  // Small enough to clear inline: the tournament row is gone without any
  // scheduled continuation running.
  const after = await countTournamentRows(t, tournamentId);
  expect(after.tournament).toBeNull();
  expect(after.total).toBe(0);
});

test("deleteTournament drains a large in-progress event via scheduled batches", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Large Delete Check",
      dummyPlayerCount: 128,
      roundsToGenerate: 3,
      seed: 22,
      autoStart: true,
    },
  );
  // Complete round 1 and pair round 2 so the event exceeds a single deletion
  // batch (matches, match players, and standings across two rounds).
  await authed.mutation(api.tournaments.testing.advanceTestRound, {
    tournamentId,
  });

  const before = await countTournamentRows(t, tournamentId);
  expect(before.total).toBeGreaterThan(512);

  await authed.mutation(api.tournaments.lifecycle.deleteTournament, {
    tournamentId,
  });

  // The first batch cannot finish, so the tournament row survives — hidden and
  // cancelled — until the scheduled continuations drain the rest.
  const during = await countTournamentRows(t, tournamentId);
  expect(during.tournament?.lifecycle).toBe("cancelled");
  expect(during.tournament?.visibility).toBe("private");

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();

  const after = await countTournamentRows(t, tournamentId);
  expect(after.tournament).toBeNull();
  expect(after.total).toBe(0);
  // Synthetic test users are removed alongside their test player rows; only
  // the organizer remains.
  const users = await t.run(
    async (ctx) => await ctx.db.query("users").collect(),
  );
  expect(users).toHaveLength(1);
});

test("deleteTournament rejects callers without organizer access", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    { organizationId, name: "Guarded Event", dummyPlayerCount: 4 },
  );

  const stranger = t.withIdentity({
    issuer: "https://convex.test",
    subject: "stranger",
    tokenIdentifier: "https://convex.test|stranger",
    email: "stranger@example.test",
    name: "Stranger",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: "https://convex.test|stranger",
      publicCode: 2,
      email: "stranger@example.test",
      name: "Stranger",
      updatedAt: Date.now(),
    });
  });

  await expect(
    stranger.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("Unauthorized");
  const rows = await countTournamentRows(t, tournamentId);
  expect(rows.tournament).not.toBeNull();
});

test("deleteTournament removes an unpublished event with no entries", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Draft Delete Check",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    },
  );

  await authed.mutation(api.tournaments.lifecycle.deleteTournament, {
    tournamentId,
  });

  const after = await countTournamentRows(t, tournamentId);
  expect(after.tournament).toBeNull();
  expect(after.total).toBe(0);
});

test("deleteTournament refuses a published event and keeps its players' history", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Published Delete Check",
    playerCount: 4,
  });
  const authed = t.withIdentity(organizerIdentity);

  await expect(
    authed.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("cancel it instead");

  const rows = await countTournamentRows(t, tournamentId);
  expect(rows.tournament?.lifecycle).toBe("registration");
  expect(rows.total).toBeGreaterThan(0);

  // Cancellation is the sanctioned exit: it ends the event and keeps every
  // row, and the cancelled event still cannot be deleted afterwards.
  await authed.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  await expect(
    authed.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("has ended");
  const cancelled = await countTournamentRows(t, tournamentId);
  expect(cancelled.tournament?.lifecycle).toBe("cancelled");
  expect(cancelled.total).toBe(rows.total);
});

test("deleteTournament refuses a completed event", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Completed Delete Check",
    playerCount: 4,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
  });
  const authed = t.withIdentity(organizerIdentity);
  await rawSeed(
    t,
    "completion is reached by playing out every round; the gate only reads the lifecycle",
    async (ctx) => {
      await ctx.db.patch(tournamentId, {
        lifecycle: "completed",
        updatedAt: Date.now(),
      });
    },
  );

  await expect(
    authed.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("has ended");
  const rows = await countTournamentRows(t, tournamentId);
  expect(rows.tournament?.lifecycle).toBe("completed");
});

test("deleteTournament refuses an unpublished event that already has an entry", async () => {
  const t = createConvexTest();
  const { organizationId, userId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Entered Draft Delete Check",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    },
  );
  await rawSeed(
    t,
    "registerSelf refuses an unpublished event; the roster check must hold on its own if a future seam enrols before publication",
    async (ctx) => {
      const tournament = await ctx.db.get(tournamentId);
      if (!tournament) {
        throw new Error("Tournament missing");
      }
      const participantId = await insertLinkedParticipant(ctx, userId);
      const now = Date.now();
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        participantId,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        createdAt: now,
        tiebreakRandom: 1,
        updatedAt: now,
      });
    },
  );

  await expect(
    authed.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("enrolled players cannot be deleted");
  const rows = await countTournamentRows(t, tournamentId);
  expect(rows.tournament).not.toBeNull();
});

test("cancelTournament cancels live events but rejects completed and cancelled ones", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);

  const tournamentId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Cancel Guard Check",
      dummyPlayerCount: 4,
      roundsToGenerate: 1,
      seed: 33,
      autoStart: true,
    },
  );

  await authed.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  const setup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  expect(setup.tournament.lifecycle).toBe("cancelled");

  await expect(
    authed.mutation(api.tournaments.lifecycle.cancelTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("already cancelled");

  const completedId = await authed.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Completed Cancel Check",
      dummyPlayerCount: 4,
      roundsToGenerate: 1,
      seed: 44,
      autoStart: true,
    },
  );
  await authed.mutation(api.tournaments.testing.advanceTestRound, {
    tournamentId: completedId,
  });
  const completedSetup = await authed.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId: completedId },
  );
  expect(completedSetup.tournament.lifecycle).toBe("completed");

  await expect(
    authed.mutation(api.tournaments.lifecycle.cancelTournament, {
      tournamentId: completedId,
    }),
  ).rejects.toThrow("cannot be cancelled");
});
