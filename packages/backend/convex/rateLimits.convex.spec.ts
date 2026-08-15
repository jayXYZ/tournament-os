/// <reference types="vite/client" />

import { expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

function identity(subject: string) {
  return {
    issuer: "https://convex.test",
    subject,
    tokenIdentifier: `https://convex.test|${subject}`,
    email: `${subject}@example.test`,
    name: subject,
  };
}

// Rejections carry the component's typed ConvexError payload so clients can
// distinguish throttling from real failures (isRateLimitError checks the same
// shape).
function rateLimited(name: string) {
  return expect.objectContaining({
    data: expect.objectContaining({ kind: "RateLimited", name }),
  });
}

async function seedPublicTournament(
  t: ReturnType<typeof createConvexTest>,
  lifecycle: "setup" | "registration",
) {
  const { organizationId, userId } = await seedOrganizer(t, 100_000);
  return await t.run(async (ctx) => {
    return await ctx.db.insert("tournaments", {
      name: "Rate Limit Open",
      publicCode: 100_001,
      organizationId,
      createdBy: userId,
      visibility: "public",
      lifecycle,
      startDate: Date.now() + 60_000,
      playerCapacity: 64,
      format: "standard",
      isTestEvent: false,
      autoPublishPairings: false,
      decklistRequired: false,
      confirmedRegistrationCount: 0,
      updatedAt: Date.now(),
    });
  });
}

test("createOrganization empties per identity and leaves other identities alone", async () => {
  const t = createConvexTest();
  const bulkCreator = t.withIdentity(identity("bulk-creator"));

  // Capacity is 3 (see rateLimits.ts); the burst succeeds and the next call
  // is rejected with the typed payload.
  for (let index = 1; index <= 3; index += 1) {
    await bulkCreator.mutation(api.organizations.createOrganizerOrganization, {
      name: `Org ${index}`,
    });
  }
  await expect(
    bulkCreator.mutation(api.organizations.createOrganizerOrganization, {
      name: "Org 4",
    }),
  ).rejects.toEqual(rateLimited("createOrganization"));

  // Buckets are keyed per identity: someone else is not starved by the abuser.
  await t
    .withIdentity(identity("bystander"))
    .mutation(api.organizations.createOrganizerOrganization, {
      name: "Bystander Org",
    });
});

test("an emptied bucket refills as time passes", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const creator = t.withIdentity(identity("refill-creator"));
    for (let index = 1; index <= 3; index += 1) {
      await creator.mutation(api.organizations.createOrganizerOrganization, {
        name: `Org ${index}`,
      });
    }
    await expect(
      creator.mutation(api.organizations.createOrganizerOrganization, {
        name: "Org 4",
      }),
    ).rejects.toEqual(rateLimited("createOrganization"));

    // 12 per day refills one token every two hours.
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000 + 1_000);
    await creator.mutation(api.organizations.createOrganizerOrganization, {
      name: "Org 4, eventually",
    });
    await expect(
      creator.mutation(api.organizations.createOrganizerOrganization, {
        name: "Org 5",
      }),
    ).rejects.toEqual(rateLimited("createOrganization"));
  } finally {
    vi.useRealTimers();
  }
});

test("failed mutations do not consume rate-limit budget", async () => {
  const t = createConvexTest();
  const tournamentId = await seedPublicTournament(t, "setup");
  const player = t.withIdentity(identity("eager-player"));

  // Every attempt fails after the bucket debit, so the debit rolls back with
  // the transaction: more failures than the whole registerSelf capacity (20)
  // must leave the budget untouched.
  for (let attempt = 0; attempt < 21; attempt += 1) {
    await expect(
      player.mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
      }),
    ).rejects.toThrow("Tournament is not open for registration");
  }

  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, { lifecycle: "registration" });
  });
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
});

test("registration churn exhausts the registerSelf bucket", async () => {
  const t = createConvexTest();
  const tournamentId: Id<"tournaments"> = await seedPublicTournament(
    t,
    "registration",
  );
  const churner = t.withIdentity(identity("churner"));

  // registerSelf holds capacity 20 and cancelMyRegistration its own 20, so
  // twenty full cycles drain both without tripping either early.
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await churner.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    });
    await churner.mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  }
  await expect(
    churner.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toEqual(rateLimited("registerSelf"));

  // The tournament itself remains open to everyone else.
  await t
    .withIdentity(identity("patient-player"))
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
});
