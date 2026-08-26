/// <reference types="vite/client" />
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// Entry-fee configuration rules on updateTournamentSetup: a fee requires a
// payouts-ready Stripe connection, refund deadlines only exist alongside a
// fee and never after the start date, and clearing the fee clears the
// deadline. The fee-freeze-once-orders-exist rule lands with the order
// records in the checkout phase.

const START_DATE = Date.UTC(2027, 5, 12, 17, 0, 0);

async function seedTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: { isTestEvent?: boolean },
) {
  const asOwner = t.withIdentity(organizerIdentity);
  const tournamentId = await asOwner.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Paid Event",
      startDate: START_DATE,
      playerCapacity: 16,
      format: "modern",
      isTestEvent: overrides?.isTestEvent ?? false,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  return tournamentId;
}

async function insertPayoutsReadyAccount(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
) {
  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .first();
    const now = Date.now();
    await ctx.db.insert("organizationStripeAccounts", {
      organizationId,
      stripeAccountId: "acct_test_ready",
      transfersCapabilityStatus: "active",
      payoutsReady: true,
      lastSyncedAt: now,
      createdBy: membership!.userId,
      updatedAt: now,
    });
  });
}

test("setting an entry fee requires a payouts-ready Stripe connection", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedTournament(t, organizationId);
  const asOwner = t.withIdentity(organizerIdentity);

  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      entryFeeCents: 2000,
    }),
  ).rejects.toThrow("Connect the organization's Stripe account");

  await insertPayoutsReadyAccount(t, organizationId);
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2000,
  });

  const { tournament } = await asOwner.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(tournament.entryFeeCents).toBe(2000);
});

test("entry fees are bounded and refused on test events", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await insertPayoutsReadyAccount(t, organizationId);
  const asOwner = t.withIdentity(organizerIdentity);

  const tournamentId = await seedTournament(t, organizationId);
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      entryFeeCents: 25,
    }),
  ).rejects.toThrow("at least");
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      entryFeeCents: 20.5,
    }),
  ).rejects.toThrow("whole number");

  const testEventId = await seedTournament(t, organizationId, {
    isTestEvent: true,
  });
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId: testEventId,
      entryFeeCents: 2000,
    }),
  ).rejects.toThrow("Test events cannot charge an entry fee");
});

test("refund deadline requires a fee, stays before the start date, and clears with the fee", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await insertPayoutsReadyAccount(t, organizationId);
  const tournamentId = await seedTournament(t, organizationId);
  const asOwner = t.withIdentity(organizerIdentity);

  // No fee yet: a deadline is meaningless.
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      refundDeadline: START_DATE - 86_400_000,
    }),
  ).rejects.toThrow("Set an entry fee before setting a refund deadline");

  // Fee and deadline together, deadline after start: refused.
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      entryFeeCents: 2000,
      refundDeadline: START_DATE + 1,
    }),
  ).rejects.toThrow("at or before the tournament start date");

  // Valid pair sticks.
  const deadline = START_DATE - 86_400_000;
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2000,
    refundDeadline: deadline,
  });
  let setup = await asOwner.query(
    api.tournaments.lifecycle.getTournamentSetup,
    {
      tournamentId,
    },
  );
  expect(setup.tournament.entryFeeCents).toBe(2000);
  expect(setup.tournament.refundDeadline).toBe(deadline);

  // Rescheduling earlier than the standing deadline is refused until the
  // deadline moves too.
  await expect(
    asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      startDate: deadline - 1,
    }),
  ).rejects.toThrow("at or before the tournament start date");

  // null clears the deadline alone; 0 clears the fee and the deadline.
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    refundDeadline: null,
  });
  setup = await asOwner.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.refundDeadline).toBeUndefined();
  expect(setup.tournament.entryFeeCents).toBe(2000);

  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2000,
    refundDeadline: deadline,
  });
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 0,
  });
  setup = await asOwner.query(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  });
  expect(setup.tournament.entryFeeCents).toBeUndefined();
  expect(setup.tournament.refundDeadline).toBeUndefined();
});

test("fee preview matches the shared breakdown math", async () => {
  const t = createConvexTest();
  const preview = await t.query(api.payments.queries.getFeePreview, {
    entryFeeCents: 2000,
  });
  expect(preview).toEqual({
    entryFeeCents: 2000,
    platformFeeCents: 100,
    processingFeeCents: 94,
    totalCents: 2194,
    currency: "usd",
  });

  await expect(
    t.query(api.payments.queries.getFeePreview, { entryFeeCents: 10 }),
  ).rejects.toThrow("at least");
});
