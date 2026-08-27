/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// Refund rules on the roster verbs: a player's pre-deadline cancel refunds
// in full and flags them, their repeat cancel refunds the entry cost only,
// an organizer removal always refunds in full without flagging, a
// past-deadline cancel refunds nothing, and webhook reconciliation recovers
// a lost executor write.

const gatewayState = vi.hoisted(() => ({
  refunds: [] as Array<{
    chargeId: string;
    amountCents: number;
    refundRowId: string;
  }>,
  expired: [] as Array<string>,
  nextSessionNumber: 1,
  // What Stripe reports on refund creation — "pending" models bank-rail
  // refunds that only settle via the refund.updated webhook.
  createRefundStatus: "succeeded" as "succeeded" | "pending" | "failed",
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
    createRefund: async (args: {
      chargeId: string;
      amountCents: number;
      refundRowId: string;
    }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: gatewayState.createRefundStatus,
      };
    },
  }),
}));

beforeEach(() => {
  gatewayState.refunds = [];
  gatewayState.expired = [];
  gatewayState.nextSessionNumber = 1;
  gatewayState.createRefundStatus = "succeeded";
});

const START_DATE = Date.UTC(2027, 5, 12, 17, 0, 0);

const playerOne = {
  issuer: "https://convex.test",
  subject: "player-1",
  tokenIdentifier: "https://convex.test|player-1",
  email: "player1@example.test",
  name: "Player 1",
};

async function seedPaidTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: { refundDeadline?: number },
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
    await ctx.db.insert("users", {
      tokenIdentifier: playerOne.tokenIdentifier,
      publicCode: 101,
      email: playerOne.email,
      name: playerOne.name,
      updatedAt: now,
    });
  });
  const tournamentId = await asOwner.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Refund Cup",
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
    refundDeadline: overrides?.refundDeadline ?? null,
  });
  await asOwner.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

async function latestOrder(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"paymentOrders">> {
  return await t.run(async (ctx) => {
    const orders = [];
    for (const status of [
      "requires_payment",
      "awaiting_payment",
      "paid",
      "canceled",
      "refunded",
      "partially_refunded",
      "expired",
      "failed",
    ] as const) {
      const page = await ctx.db
        .query("paymentOrders")
        .withIndex("by_tournamentId_and_status", (q) =>
          q.eq("tournamentId", tournamentId).eq("status", status),
        )
        .take(16);
      orders.push(...page);
    }
    orders.sort((a, b) => b._creationTime - a._creationTime);
    return orders[0]!;
  });
}

async function payForEntry(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  eventSuffix: string,
) {
  await t
    .withIdentity(playerOne)
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  const order = await latestOrder(t, tournamentId);
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: `evt_${eventSuffix}`,
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
    stripePaymentIntentId: `pi_${eventSuffix}`,
    stripeChargeId: `ch_${eventSuffix}`,
  });
  return order._id;
}

async function refundsFor(
  t: TestConvex<typeof schema>,
  orderId: Id<"paymentOrders">,
) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .take(8),
  );
}

async function runQueuedRefund(
  t: TestConvex<typeof schema>,
  orderId: Id<"paymentOrders">,
) {
  const [refund] = await refundsFor(t, orderId);
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  return refund!._id;
}

test("first player cancel refunds in full with the organizer absorbing the fee; repeat cancel refunds entry only", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const firstOrderId = await payForEntry(t, tournamentId, "one");
  let flag = await asPlayer.query(api.payments.queries.getMyRefundFlag, {
    tournamentId,
  });
  expect(flag.repeatDropFeesKept).toBe(false);
  const beforeCancel = await asPlayer.query(
    api.payments.queries.getMyEntryOrder,
    { tournamentId },
  );
  expect(beforeCancel?.cancelOutcome).toBe("full_refund");

  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [firstRefund] = await refundsFor(t, firstOrderId);
  expect(firstRefund).toMatchObject({
    kind: "full",
    reason: "player_cancel",
    amountCents: 2194,
    absorbedFeeCents: 94,
    status: "pending",
  });
  await runQueuedRefund(t, firstOrderId);
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");

  // The flag now stands, and the player is warned before paying again.
  flag = await asPlayer.query(api.payments.queries.getMyRefundFlag, {
    tournamentId,
  });
  expect(flag.repeatDropFeesKept).toBe(true);

  const secondOrderId = await payForEntry(t, tournamentId, "two");
  const beforeSecondCancel = await asPlayer.query(
    api.payments.queries.getMyEntryOrder,
    { tournamentId },
  );
  expect(beforeSecondCancel?.cancelOutcome).toBe("entry_only_refund");

  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [secondRefund] = await refundsFor(t, secondOrderId);
  expect(secondRefund).toMatchObject({
    kind: "entry_only",
    reason: "player_cancel",
    amountCents: 2000,
    absorbedFeeCents: 0,
  });
  await runQueuedRefund(t, secondOrderId);
  expect((await latestOrder(t, tournamentId)).status).toBe(
    "partially_refunded",
  );
});

test("organizer removal always refunds in full and never flags the player", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);

  const orderId = await payForEntry(t, tournamentId, "one");
  const registrationId = (await t.run(
    async (ctx) => (await ctx.db.get(orderId))!.registrationId,
  )) as Id<"tournamentRegistrations">;

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.registrations.rejectRegistration, {
      registrationId,
    });
  const [refund] = await refundsFor(t, orderId);
  expect(refund).toMatchObject({
    kind: "full",
    reason: "organizer_remove",
    amountCents: 2194,
    absorbedFeeCents: 94,
  });

  const flag = await t
    .withIdentity(playerOne)
    .query(api.payments.queries.getMyRefundFlag, { tournamentId });
  expect(flag.repeatDropFeesKept).toBe(false);
});

test("a cancel past the refund deadline refunds nothing and the order stays paid", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId, {
    refundDeadline: Date.now() - 86_400_000,
  });
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  const beforeCancel = await asPlayer.query(
    api.payments.queries.getMyEntryOrder,
    { tournamentId },
  );
  expect(beforeCancel?.cancelOutcome).toBe("no_refund");

  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  expect(await refundsFor(t, orderId)).toHaveLength(0);
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
});

test("withdrawing an unpaid checkout closes the order without a refund", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });

  const order = await latestOrder(t, tournamentId);
  expect(order.status).toBe("canceled");
  expect(await refundsFor(t, order._id)).toHaveLength(0);
});

test("a refund Stripe reports as pending stays pending until the webhook settles it", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });

  // Stripe accepts the creation but the money is still moving: the row must
  // not be declared succeeded (the order stays paid), only the Stripe id is
  // recorded so the webhook can find the row.
  gatewayState.createRefundStatus = "pending";
  const refundId = await runQueuedRefund(t, orderId);
  let [refund] = await refundsFor(t, orderId);
  expect(refund).toMatchObject({
    status: "pending",
    stripeRefundId: "re_test_1",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");

  // The refund.updated webhook settles it by Stripe refund id.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_settle",
    stripeRefundId: "re_test_1",
    refundStatus: "succeeded",
    refundRowId: refundId,
  });
  [refund] = await refundsFor(t, orderId);
  expect(refund!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a refund Stripe reports as failed on creation is recorded as failed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });

  gatewayState.createRefundStatus = "failed";
  await runQueuedRefund(t, orderId);
  const [refund] = await refundsFor(t, orderId);
  expect(refund!.status).toBe("failed");
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
});

test("a pending refund a webhook reports canceled is recorded as failed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  gatewayState.createRefundStatus = "pending";
  await runQueuedRefund(t, orderId);

  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_cancel",
    stripeRefundId: "re_test_1",
    refundStatus: "canceled",
    refundRowId: null,
  });
  const [refund] = await refundsFor(t, orderId);
  expect(refund!.status).toBe("failed");
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
});

test("refund reconciliation recovers a lost executor write by row id", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  expect(refund!.status).toBe("pending");

  // The executor never reported (crash between the Stripe call and the
  // result write) — the refund.updated webhook carries our row id in
  // metadata and settles it.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_1",
    stripeRefundId: "re_lost_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
  });

  const [settled] = await refundsFor(t, orderId);
  expect(settled).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_lost_1",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});
