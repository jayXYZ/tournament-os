/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The lifecycle money sweeps and guards: cancelling a paid tournament makes
// every player whole (including a repeat-dropper's withheld fees), starting
// one lapses open checkouts, hard deletion refuses while money is
// unsettled, and a disputed order is excluded from the payout.

const gatewayState = vi.hoisted(() => ({
  refunds: [] as Array<{ chargeId: string; amountCents: number }>,
  transfers: [] as Array<{ amountCents: number; sourceChargeId: string }>,
  expired: [] as Array<string>,
  nextSessionNumber: 1,
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
    expireCheckoutSession: async (args: { sessionId: string }) => {
      gatewayState.expired.push(args.sessionId);
    },
    createRefund: async (args: { chargeId: string; amountCents: number }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: "succeeded" as const,
      };
    },
    retrieveTransfersCapabilityStatus: async () => "active",
    createTransfer: async (args: {
      amountCents: number;
      sourceChargeId: string;
    }) => {
      gatewayState.transfers.push(args);
      return { stripeTransferId: `tr_test_${gatewayState.transfers.length}` };
    },
  }),
}));

beforeEach(() => {
  gatewayState.refunds = [];
  gatewayState.transfers = [];
  gatewayState.expired = [];
  gatewayState.nextSessionNumber = 1;
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
      name: "Sweep Cup",
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

async function ensurePlayer(t: TestConvex<typeof schema>, n: number) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", playerIdentity(n).tokenIdentifier),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("users", {
        tokenIdentifier: playerIdentity(n).tokenIdentifier,
        publicCode: 100 + n,
        email: playerIdentity(n).email,
        name: playerIdentity(n).name,
        updatedAt: Date.now(),
      });
    }
  });
}

let chargeCounter = 0;

async function beginCheckout(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  n: number,
) {
  await ensurePlayer(t, n);
  await t
    .withIdentity(playerIdentity(n))
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  return await t.run(async (ctx) => {
    const orders = await ctx.db
      .query("paymentOrders")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", tournamentId).eq("status", "awaiting_payment"),
      )
      .take(32);
    return orders.at(-1)!;
  });
}

async function payAsPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  n: number,
) {
  const order = await beginCheckout(t, tournamentId, n);
  chargeCounter += 1;
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: `evt_${chargeCounter}`,
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
    stripePaymentIntentId: `pi_${chargeCounter}`,
    stripeChargeId: `ch_${chargeCounter}`,
  });
  return order._id;
}

async function orderById(
  t: TestConvex<typeof schema>,
  orderId: Id<"paymentOrders">,
): Promise<Doc<"paymentOrders">> {
  return await t.run(async (ctx) => (await ctx.db.get(orderId))!);
}

async function drainScheduler(t: TestConvex<typeof schema>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

test("cancelling a paid tournament refunds everyone, including a repeat-dropper's withheld fees", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  // Player 1: repeat dropper — full refund, re-pay, entry-only refund.
  await payAsPlayer(t, tournamentId, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  await drainScheduler(t);
  const repeatOrderId = await payAsPlayer(t, tournamentId, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  await drainScheduler(t);
  expect((await orderById(t, repeatOrderId)).status).toBe("partially_refunded");

  // Player 2 stays paid; player 3 has an open checkout.
  const paidOrderId = await payAsPlayer(t, tournamentId, 2);
  const openOrder = await beginCheckout(t, tournamentId, 3);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.cancelTournament, { tournamentId });
  await drainScheduler(t);

  // The open checkout closed and its session expired.
  expect((await orderById(t, openOrder._id)).status).toBe("canceled");
  expect(gatewayState.expired).toContain(openOrder.stripeCheckoutSessionId);
  // The paid order refunded in full.
  expect((await orderById(t, paidOrderId)).status).toBe("refunded");
  // The repeat-dropper got the withheld fees (2194 − 2000) back too.
  const remainderRefund = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", repeatOrderId))
        .take(8)
    ).find((refund) => refund.reason === "tournament_cancelled"),
  );
  expect(remainderRefund).toMatchObject({
    amountCents: 194,
    status: "succeeded",
  });
  expect((await orderById(t, repeatOrderId)).status).toBe("refunded");
});

test("the cancel sweep counts refunds already in flight instead of double-refunding", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  // Player 1: repeat dropper whose entry-only refund is still PENDING when
  // the cancellation sweeps — the sweep must queue only the withheld fees,
  // or the two refunds together would exceed the charge and the second
  // would fail at Stripe, stranding the fees.
  await payAsPlayer(t, tournamentId, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  await drainScheduler(t);
  const repeatOrderId = await payAsPlayer(t, tournamentId, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });

  // Player 2: a full player-cancel refund also still pending — the sweep
  // must queue nothing (everything is already coming back).
  const fullPendingOrderId = await payAsPlayer(t, tournamentId, 2);
  await t
    .withIdentity(playerIdentity(2))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });

  // Both cancel refunds are queued but unexecuted (no drain): the sweep
  // observes them as pending, exactly the webhook-vs-sweep race.
  await t.mutation(internal.payments.refunds.cancelTournamentPaymentsSweep, {
    tournamentId,
  });

  const repeatRefunds = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", repeatOrderId))
        .take(8),
  );
  const sweepRefund = repeatRefunds.find(
    (refund) => refund.reason === "tournament_cancelled",
  );
  expect(sweepRefund).toMatchObject({ amountCents: 194 });

  const fullPendingRefunds = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", fullPendingOrderId))
        .take(8),
  );
  expect(
    fullPendingRefunds.filter((r) => r.reason === "tournament_cancelled"),
  ).toHaveLength(0);

  await drainScheduler(t);
  // Whatever order the refunds settled in, both orders end fully refunded
  // and no charge was over-refunded.
  expect((await orderById(t, repeatOrderId)).status).toBe("refunded");
  expect((await orderById(t, fullPendingOrderId)).status).toBe("refunded");
  const repeatCharge = (await orderById(t, repeatOrderId)).stripeChargeId!;
  const refundedOnRepeatCharge = gatewayState.refunds
    .filter((r) => r.chargeId === repeatCharge)
    .reduce((sum, r) => sum + r.amountCents, 0);
  expect(refundedOnRepeatCharge).toBe(2194);
});

test("starting a paid tournament lapses open checkouts without touching paid seats", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  const paidOne = await payAsPlayer(t, tournamentId, 1);
  const paidTwo = await payAsPlayer(t, tournamentId, 2);
  const openOrder = await beginCheckout(t, tournamentId, 3);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });
  await drainScheduler(t);

  expect((await orderById(t, openOrder._id)).status).toBe("canceled");
  expect(gatewayState.expired).toContain(openOrder.stripeCheckoutSessionId);
  expect((await orderById(t, paidOne)).status).toBe("paid");
  expect((await orderById(t, paidTwo)).status).toBe("paid");
});

test("hard deletion refuses while payments are unsettled and proceeds after the cancel sweep", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await payAsPlayer(t, tournamentId, 1);
  const asOwner = t.withIdentity(organizerIdentity);

  await expect(
    asOwner.mutation(api.tournaments.lifecycle.deleteTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("still holds player payments");

  await asOwner.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });
  await drainScheduler(t);

  await asOwner.mutation(api.tournaments.lifecycle.deleteTournament, {
    tournamentId,
  });
  await drainScheduler(t);
  expect(await t.run(async (ctx) => ctx.db.get(tournamentId))).toBeNull();
});

test("a disputed order is excluded from the payout", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  await payAsPlayer(t, tournamentId, 1);
  const disputedOrderId = await payAsPlayer(t, tournamentId, 2);
  const disputedCharge = (await orderById(t, disputedOrderId)).stripeChargeId!;

  await t.mutation(internal.payments.webhooks.handleDisputeCreated, {
    stripeEventId: "evt_dispute_1",
    stripeChargeId: disputedCharge,
  });
  expect((await orderById(t, disputedOrderId)).status).toBe("disputed");

  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, {
      lifecycle: "completed",
      updatedAt: Date.now(),
    });
  });
  await t.mutation(internal.payments.payouts.startPayoutSweep, {
    tournamentId,
  });
  await drainScheduler(t);

  expect(gatewayState.transfers).toHaveLength(1);
  expect(gatewayState.transfers[0]!.amountCents).toBe(2000);
  expect(gatewayState.transfers[0]!.sourceChargeId).not.toBe(disputedCharge);

  const auditTypes = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event.type),
  );
  expect(auditTypes).toContain("order_disputed");
});
