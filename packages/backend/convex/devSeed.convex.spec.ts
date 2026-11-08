/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// The dev-only seeding hook (devSeed.ts) behind the native join E2E: it
// stands in a payouts-ready Stripe account on a development deployment, and
// nowhere else.

afterEach(() => {
  vi.unstubAllEnvs();
});

test("a development deployment gets a payouts-ready account the fee gate accepts", async () => {
  vi.stubEnv(
    "CLERK_JWT_ISSUER_DOMAIN",
    "https://example-slug.clerk.accounts.dev",
  );
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Seeded Paid Event",
      startDate: Date.UTC(2027, 5, 12, 17, 0, 0),
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );

  await t.mutation(internal.devSeed.markOrganizationPayoutsReady, {
    organizationId,
  });
  // A second run keeps the one row.
  await t.mutation(internal.devSeed.markOrganizationPayoutsReady, {
    organizationId,
  });

  const accounts = await t.run((ctx) =>
    ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
  );
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ payoutsReady: true });

  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 1500,
  });
  const tournament = await t.run((ctx) => ctx.db.get(tournamentId));
  expect(tournament?.entryFeeCents).toBe(1500);
});

test("any other deployment refuses the seed", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example.com");
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);

  await expect(
    t.mutation(internal.devSeed.markOrganizationPayoutsReady, {
      organizationId,
    }),
  ).rejects.toThrow(/development deployment/);
  const account = await t.run((ctx) =>
    ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .first(),
  );
  expect(account).toBeNull();
});

// Checkout charges the platform account, never the stand-in (the stand-in
// only fails at payout), so a live key would take real money for a seeded
// paid event. The guard is an allow-list: a test-mode key passes, and a key
// of any other shape is refused.
test.each(["sk_test_example", "rk_test_example"])(
  "a deployment whose Stripe key is test-mode (%s) accepts the seed",
  async (key) => {
    vi.stubEnv(
      "CLERK_JWT_ISSUER_DOMAIN",
      "https://example-slug.clerk.accounts.dev",
    );
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);

    await t.mutation(internal.devSeed.markOrganizationPayoutsReady, {
      organizationId,
    });
    const account = await t.run((ctx) =>
      ctx.db
        .query("organizationStripeAccounts")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId),
        )
        .first(),
    );
    expect(account).toMatchObject({ payoutsReady: true });
  },
);

test.each([
  "sk_live_example",
  "rk_live_example",
  " sk_live_example ",
  "sk_other_example",
])(
  "a deployment whose Stripe key is not test-mode (%j) refuses the seed",
  async (key) => {
    vi.stubEnv(
      "CLERK_JWT_ISSUER_DOMAIN",
      "https://example-slug.clerk.accounts.dev",
    );
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);

    await expect(
      t.mutation(internal.devSeed.markOrganizationPayoutsReady, {
        organizationId,
      }),
    ).rejects.toThrow(/test-mode Stripe key/);
  },
);
