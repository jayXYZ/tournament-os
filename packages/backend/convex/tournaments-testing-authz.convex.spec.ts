/// <reference types="vite/client" />

// The test-results helper takes a tournament and an optional round. The
// round must belong to the authorized tournament: an organizer of a test
// event in one organization must not be able to point the simulator at a
// round of another organization's event.

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateTestResults } from "./model/testing";
import { requireRound, requireTournament } from "./model/tournaments";
import schema from "./schema";
import { currentRound, organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

const rivalOrganizerIdentity = {
  issuer: "https://convex.test",
  subject: "rival-organizer",
  tokenIdentifier: "https://convex.test|rival-organizer",
  email: "rival@example.test",
  name: "Rival Organizer",
};

// A second organizer owning a second, unrelated organization.
async function seedRivalOrganizer(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: rivalOrganizerIdentity.tokenIdentifier,
      publicCode: 2,
      email: rivalOrganizerIdentity.email,
      name: rivalOrganizerIdentity.name,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Rival Org",
      slug: "rival-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      email: rivalOrganizerIdentity.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });
    return { organizationId, userId };
  });
}

async function seedStartedTestTournament(
  t: TestConvex<typeof schema>,
  identity: typeof organizerIdentity,
  organizationId: Id<"organizations">,
  name: string,
) {
  return await t
    .withIdentity(identity)
    .mutation(api.tournaments.testing.createTestTournament, {
      organizationId,
      name,
      dummyPlayerCount: 8,
      roundsToGenerate: 3,
      seed: 7,
      autoStart: true,
    });
}

async function roundResultCount(
  t: TestConvex<typeof schema>,
  roundId: Id<"tournamentRounds">,
) {
  return await t.run(async (ctx) => {
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", roundId),
      )
      .collect();
    return matches.filter(
      (match) => match.currentResultRevisionId !== undefined,
    ).length;
  });
}

test("generateTestRoundResults rejects a round from another organization's tournament", async () => {
  const t = createConvexTest();
  const { organizationId: ownOrganizationId } = await seedOrganizer(t);
  const { organizationId: rivalOrganizationId } = await seedRivalOrganizer(t);

  const ownTournamentId = await seedStartedTestTournament(
    t,
    organizerIdentity,
    ownOrganizationId,
    "Own Event",
  );
  const victimTournamentId = await seedStartedTestTournament(
    t,
    rivalOrganizerIdentity,
    rivalOrganizationId,
    "Victim Event",
  );
  const victimRound = await currentRound(t, victimTournamentId);
  expect(await roundResultCount(t, victimRound._id)).toBe(0);

  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.testing.generateTestRoundResults, {
        tournamentId: ownTournamentId,
        roundId: victimRound._id,
      }),
  ).rejects.toThrow("Round does not belong to this tournament");

  // The victim's matches stay untouched.
  expect(await roundResultCount(t, victimRound._id)).toBe(0);

  // The organizer's own round still simulates normally.
  const ownRound = await currentRound(t, ownTournamentId);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.testing.generateTestRoundResults, {
      tournamentId: ownTournamentId,
      roundId: ownRound._id,
    });
  expect(await roundResultCount(t, ownRound._id)).toBeGreaterThan(0);
});

test("generateTestResults refuses a round outside the given tournament", async () => {
  const t = createConvexTest();
  const { organizationId: ownOrganizationId } = await seedOrganizer(t);
  const { organizationId: rivalOrganizationId } = await seedRivalOrganizer(t);

  const ownTournamentId = await seedStartedTestTournament(
    t,
    organizerIdentity,
    ownOrganizationId,
    "Own Event",
  );
  const victimTournamentId = await seedStartedTestTournament(
    t,
    rivalOrganizerIdentity,
    rivalOrganizationId,
    "Victim Event",
  );
  const victimRound = await currentRound(t, victimTournamentId);

  await expect(
    t.run(async (ctx) => {
      await generateTestResults(
        ctx,
        await requireTournament(ctx, ownTournamentId),
        await requireRound(ctx, victimRound._id),
      );
    }),
  ).rejects.toThrow("Round does not belong to this tournament");
  expect(await roundResultCount(t, victimRound._id)).toBe(0);
});
