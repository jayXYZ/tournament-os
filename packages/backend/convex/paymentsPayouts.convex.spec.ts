/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The completion payout sweep: one transfer per paid order minus the greedy
// absorbed-fee deduction, blocked while refunds settle, blocked when the
// live capability is not active, and failed after transfer retries exhaust.
// The whole scheduled chain (enumerate → send → finalize) runs under
// convex-test's scheduler with the gateway mocked.

const gatewayState = vi.hoisted(() => ({
  transfers: [] as Array<{
    destinationAccountId: string;
    amountCents: number;
    sourceChargeId: string;
    transferGroup: string;
  }>,
  refunds: [] as Array<{ chargeId: string; amountCents: number }>,
  nextSessionNumber: 1,
  capabilityStatus: "active" as string,
  failTransfers: false,
}));

vi.mock("./stripe/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("./stripe/config")>();
  return {
    ...original,
    requireStripeSecretKey: () => "rk_test_fake",
    requireWebAppOrigin: () => "https://app.test",
    isStripeConfigured: () => true,
  };
});

vi.mock("./stripe/client", () => ({
  getStripeGateway: () => ({
    createCheckoutSession: async () => {
      const sessionId = `cs_test_${gatewayState.nextSessionNumber++}`;
      return { sessionId, url: `https://checkout.stripe.test/${sessionId}` };
    },
    expireCheckoutSession: async () => {},
    createRefund: async (args: { chargeId: string; amountCents: number }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: "succeeded" as const,
      };
    },
    retrieveTransfersCapabilityStatus: async () =>
      gatewayState.capabilityStatus,
    createTransfer: async (args: {
      destinationAccountId: string;
      amountCents: number;
      sourceChargeId: string;
      transferGroup: string;
    }) => {
      if (gatewayState.failTransfers) {
        throw new Error("transfer boom");
      }
      gatewayState.transfers.push(args);
      return { stripeTransferId: `tr_test_${gatewayState.transfers.length}` };
    },
  }),
}));

beforeEach(() => {
  gatewayState.transfers = [];
  gatewayState.refunds = [];
  gatewayState.nextSessionNumber = 1;
  gatewayState.capabilityStatus = "active";
  gatewayState.failTransfers = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const START_DATE = Date.UTC(2027, 5, 12, 17, 0, 0);

function playerIdentity(n: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${n}`,
    tokenIdentifier: `https://convex.test|player-${n}`,
    email: `player${n}@example.test`,
    name: `Player ${n}`,
  };
}

async function seedPaidTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
) {
  const asOwner = t.withIdentity(organizerIdentity);
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
  const tournamentId = await asOwner.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Payout Cup",
      startDate: START_DATE,
      playerCapacity: 16,
      format: "modern",
      isTestEvent: false,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2000,
  });
  await asOwner.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

async function payAsPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  n: number,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(n).tokenIdentifier,
      publicCode: 100 + n,
      email: playerIdentity(n).email,
      name: playerIdentity(n).name,
      updatedAt: Date.now(),
    });
  });
  await t
    .withIdentity(playerIdentity(n))
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  const order = await t.run(async (ctx) => {
    const orders = await ctx.db
      .query("paymentOrders")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", tournamentId).eq("status", "awaiting_payment"),
      )
      .take(16);
    return orders.at(-1)!;
  });
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: `evt_p${n}`,
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
    stripePaymentIntentId: `pi_p${n}`,
    stripeChargeId: `ch_p${n}`,
  });
  return order._id;
}

async function markCompleted(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, {
      lifecycle: "completed",
      updatedAt: Date.now(),
    });
  });
}

async function payoutDoc(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"tournamentPayouts">> {
  return await t.run(
    async (ctx) =>
      (await ctx.db
        .query("tournamentPayouts")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .unique())!,
  );
}

async function drainScheduler(t: TestConvex<typeof schema>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

test("payout transfers entry fees minus the absorbed refund fees, greedily deducted", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  // Player 1 pays then cancels (full refund; organizer absorbs the 94¢
  // estimate); players 2 and 3 stay paid.
  await payAsPlayer(t, tournamentId, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  await payAsPlayer(t, tournamentId, 2);
  await payAsPlayer(t, tournamentId, 3);
  await drainScheduler(t); // executes the queued refund

  await markCompleted(t, tournamentId);
  await t.mutation(internal.payments.payouts.startPayoutSweep, {
    tournamentId,
  });
  await drainScheduler(t);

  const payout = await payoutDoc(t, tournamentId);
  expect(payout).toMatchObject({
    status: "completed",
    totalEntryCents: 4000,
    absorbedFeeCents: 94,
    netCents: 3906,
  });

  expect(gatewayState.transfers).toHaveLength(2);
  expect(
    gatewayState.transfers.map((transfer) => transfer.amountCents),
  ).toEqual([1906, 2000]);
  for (const transfer of gatewayState.transfers) {
    expect(transfer.destinationAccountId).toBe("acct_test_ready");
    expect(transfer.sourceChargeId).toMatch(/^ch_p/);
    expect(transfer.transferGroup).toMatch(/^order:/);
  }

  const auditTypes = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event),
  );
  expect(auditTypes).toContainEqual({ type: "payout_sent", netCents: 3906 });
});

test("payout blocks while refunds are pending and the owner can retry once they settle", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  const orderId = await payAsPlayer(t, tournamentId, 1);
  await payAsPlayer(t, tournamentId, 2);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  // Deliberately do NOT drain the scheduler: the refund stays pending.
  await markCompleted(t, tournamentId);
  await t.mutation(internal.payments.payouts.startPayoutSweep, {
    tournamentId,
  });
  expect(await payoutDoc(t, tournamentId)).toMatchObject({
    status: "blocked",
    error: "Refunds are still settling",
  });

  // Settle the refund, then retry as the owner.
  const refund = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .take(2)
    ).at(0),
  );
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  await t
    .withIdentity(organizerIdentity)
    .mutation(internal.payments.payouts.beginPayoutRetry, { tournamentId });
  await drainScheduler(t);

  expect(await payoutDoc(t, tournamentId)).toMatchObject({
    status: "completed",
    netCents: 2000 - 94,
  });
});

test("an inactive live capability blocks the send stage", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await payAsPlayer(t, tournamentId, 1);
  await markCompleted(t, tournamentId);

  gatewayState.capabilityStatus = "restricted";
  await t.mutation(internal.payments.payouts.startPayoutSweep, {
    tournamentId,
  });
  await drainScheduler(t);

  expect(await payoutDoc(t, tournamentId)).toMatchObject({
    status: "blocked",
    error: "The organization's Stripe account is not ready to receive payouts",
  });
  expect(gatewayState.transfers).toHaveLength(0);
});

test("persistent transfer failures exhaust their retries and fail the payout", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await payAsPlayer(t, tournamentId, 1);
  await markCompleted(t, tournamentId);

  gatewayState.failTransfers = true;
  await t.mutation(internal.payments.payouts.startPayoutSweep, {
    tournamentId,
  });
  await drainScheduler(t);

  expect(await payoutDoc(t, tournamentId)).toMatchObject({
    status: "failed",
    error: "transfer boom",
  });
  const auditTypes = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event.type),
  );
  expect(auditTypes).toContain("payout_failed");
});
