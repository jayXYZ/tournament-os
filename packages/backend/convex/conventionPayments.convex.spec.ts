/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  organizerIdentity,
  playerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The badge money path end to end through the shared payment engine:
// checkout begin/attach, webhook fulfillment with the capacity re-check,
// player-cancel refunds with the repeat rule, the convention cancellation
// sweep, the completion payout, and the fee freeze. The Stripe gateway is
// mocked; every state change under test is a Convex mutation.

const gatewayState = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  expired: [] as Array<string>,
  refunds: [] as Array<{ chargeId: string; amountCents: number }>,
  transfers: [] as Array<{ amountCents: number; sourceChargeId: string }>,
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
    createCheckoutSession: async (args: Record<string, unknown>) => {
      gatewayState.sessions.push(args);
      const sessionId = `cs_test_${gatewayState.nextSessionNumber++}`;
      return { sessionId, url: `https://checkout.stripe.test/${sessionId}` };
    },
    expireCheckoutSession: async (args: { sessionId: string }) => {
      gatewayState.expired.push(args.sessionId);
    },
    retrieveCheckoutSessionStatus: async () => "expired" as const,
    createRefund: async (args: { chargeId: string; amountCents: number }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: "succeeded" as const,
      };
    },
    retrieveTransfersCapabilityStatus: async () => "active" as const,
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
  gatewayState.sessions = [];
  gatewayState.expired = [];
  gatewayState.refunds = [];
  gatewayState.transfers = [];
  gatewayState.nextSessionNumber = 1;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const START = Date.UTC(2027, 7, 6, 16, 0, 0);
const END = Date.UTC(2027, 7, 8, 23, 0, 0);
const BADGE_FEE_CENTS = 2000;

async function seedPaidConvention(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: { playerCapacity?: number },
) {
  const organizer = t.withIdentity(organizerIdentity);
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
  const conventionId: Id<"conventions"> = await organizer.mutation(
    api.conventions.lifecycle.createConvention,
    {
      organizationId,
      name: "Paid Gathering",
      startDate: START,
      endDate: END,
      playerCapacity: overrides?.playerCapacity ?? 50,
    },
  );
  // Price the seeded default pass (ADR 0004: fees live on ticket types).
  const ticketTypes = await organizer.query(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId },
  );
  const ticketTypeId = ticketTypes[0]!._id;
  await organizer.mutation(api.conventions.ticketTypes.updateTicketType, {
    ticketTypeId,
    name: "Weekend badge",
    priceCents: BADGE_FEE_CENTS,
  });
  await organizer.mutation(api.conventions.lifecycle.publishConvention, {
    conventionId,
  });
  return { conventionId, ticketTypeId };
}

async function insertPlayerUser(t: TestConvex<typeof schema>, n: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(n).tokenIdentifier,
      publicCode: 100 + n,
      email: playerIdentity(n).email,
      name: playerIdentity(n).name,
      updatedAt: Date.now(),
    });
  });
}

async function latestBadgeOrder(
  t: TestConvex<typeof schema>,
  conventionId: Id<"conventions">,
  n: number,
) {
  const badge = await t
    .withIdentity(playerIdentity(n))
    .query(api.conventions.registrations.getMyBadge, { conventionId });
  const order = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("paymentOrders")
        .withIndex("by_registrationId", (q) =>
          q.eq("registrationId", badge!._id),
        )
        .order("desc")
        .take(1)
    ).at(0),
  );
  if (!order) {
    throw new Error("No badge order found in test");
  }
  return order;
}

async function completePayment(
  t: TestConvex<typeof schema>,
  order: Doc<"paymentOrders">,
  eventSuffix: string,
) {
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: `evt_${eventSuffix}`,
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
    stripePaymentIntentId: `pi_${eventSuffix}`,
    stripeChargeId: `ch_${eventSuffix}`,
  });
}

async function buyBadge(
  t: TestConvex<typeof schema>,
  conventionId: Id<"conventions">,
  ticketTypeId: Id<"conventionTicketTypes">,
  n: number,
  eventSuffix: string,
) {
  await insertPlayerUser(t, n);
  await t
    .withIdentity(playerIdentity(n))
    .action(api.payments.checkout.createBadgeCheckout, {
      conventionId,
      ticketTypeId,
    });
  const order = await latestBadgeOrder(t, conventionId, n);
  await completePayment(t, order, eventSuffix);
  return order;
}

async function drainScheduler(t: TestConvex<typeof schema>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

test("badge checkout files a pending badge and the webhook confirms it, owning the order by conventionId", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));

  // The free-registration path refuses a paid ticket.
  await expect(
    player.mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId,
    }),
  ).rejects.toThrow(/payment checkout/);

  await player.action(api.payments.checkout.createBadgeCheckout, {
    conventionId,
    ticketTypeId,
  });
  let badge = await player.query(api.conventions.registrations.getMyBadge, {
    conventionId,
  });
  expect(badge?.entryStatus).toBe("pending");
  let order = await latestBadgeOrder(t, conventionId, 1);
  expect(order).toMatchObject({
    conventionId,
    status: "awaiting_payment",
  });
  // Exactly one owner: a badge order never carries a tournamentId.
  expect(order.tournamentId).toBeUndefined();

  await completePayment(t, order, "one");
  badge = await player.query(api.conventions.registrations.getMyBadge, {
    conventionId,
  });
  expect(badge?.entryStatus).toBe("confirmed");
  order = await latestBadgeOrder(t, conventionId, 1);
  expect(order.status).toBe("paid");
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))
      ?.confirmedRegistrationCount,
  ).toBe(1);
});

test("a payment landing after badges sell out refunds instead of overselling", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
    { playerCapacity: 1 },
  );
  await insertPlayerUser(t, 1);
  await insertPlayerUser(t, 2);

  // Both begin checkout while a badge is still available.
  await t
    .withIdentity(playerIdentity(1))
    .action(api.payments.checkout.createBadgeCheckout, {
      conventionId,
      ticketTypeId,
    });
  await t
    .withIdentity(playerIdentity(2))
    .action(api.payments.checkout.createBadgeCheckout, {
      conventionId,
      ticketTypeId,
    });

  await completePayment(t, await latestBadgeOrder(t, conventionId, 1), "won");
  await completePayment(t, await latestBadgeOrder(t, conventionId, 2), "lost");

  expect(
    (
      await t
        .withIdentity(playerIdentity(2))
        .query(api.conventions.registrations.getMyBadge, { conventionId })
    )?.entryStatus,
  ).toBe("cancelled");
  await drainScheduler(t);
  expect(gatewayState.refunds).toHaveLength(1);
  const loserOrder = await latestBadgeOrder(t, conventionId, 2);
  expect(loserOrder.status).toBe("refunded");
  const refund = await t.run(async (ctx) =>
    ctx.db
      .query("paymentRefunds")
      .withIndex("by_orderId", (q) => q.eq("orderId", loserOrder._id))
      .unique(),
  );
  expect(refund).toMatchObject({
    reason: "seat_unavailable",
    conventionId,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))
      ?.confirmedRegistrationCount,
  ).toBe(1);
});

test("cancelling a paid badge refunds in full, and only the badge cost on a repeat", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await buyBadge(t, conventionId, ticketTypeId, 1, "first");
  const player = t.withIdentity(playerIdentity(1));

  await player.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });
  await drainScheduler(t);
  const firstOrder = await latestBadgeOrder(t, conventionId, 1);
  expect(firstOrder.status).toBe("refunded");
  expect(gatewayState.refunds).toHaveLength(1);
  expect(gatewayState.refunds[0]!.amountCents).toBe(
    firstOrder.amountBreakdown.totalCents,
  );

  // Pay again, cancel again: the repeat-drop rule keeps the fees.
  await player.action(api.payments.checkout.createBadgeCheckout, {
    conventionId,
    ticketTypeId,
  });
  await completePayment(
    t,
    await latestBadgeOrder(t, conventionId, 1),
    "second",
  );
  await player.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });
  await drainScheduler(t);
  const secondOrder = await latestBadgeOrder(t, conventionId, 1);
  expect(secondOrder.status).toBe("partially_refunded");
  expect(gatewayState.refunds).toHaveLength(2);
  expect(gatewayState.refunds[1]!.amountCents).toBe(BADGE_FEE_CENTS);
});

test("the badge refund default anchors to the convention start: the panel promises what cancelling does", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await buyBadge(t, conventionId, ticketTypeId, 1, "first");
  const player = t.withIdentity(playerIdentity(1));

  // Before the start, the window (refundDeadline ?? startDate) is open.
  expect(
    (await player.query(api.payments.queries.getMyBadgeOrder, {
      conventionId,
    }))!.cancelOutcome,
  ).toBe("full_refund");

  // Mid-con, the panel and the cancel mutation agree: no refund.
  vi.setSystemTime(START + 60 * 60 * 1000);
  expect(
    (await player.query(api.payments.queries.getMyBadgeOrder, {
      conventionId,
    }))!.cancelOutcome,
  ).toBe("no_refund");
  await player.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });
  await drainScheduler(t);
  expect(gatewayState.refunds).toHaveLength(0);
  expect((await latestBadgeOrder(t, conventionId, 1)).status).toBe("paid");
});

test("cancelling the convention makes every badge holder whole", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await buyBadge(t, conventionId, ticketTypeId, 1, "a");
  await buyBadge(t, conventionId, ticketTypeId, 2, "b");

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.conventions.lifecycle.cancelConvention, { conventionId });
  await drainScheduler(t);

  expect(gatewayState.refunds).toHaveLength(2);
  const refunds = await t.run(async (ctx) =>
    ctx.db
      .query("paymentRefunds")
      .withIndex("by_conventionId_and_status", (q) =>
        q.eq("conventionId", conventionId).eq("status", "succeeded"),
      )
      .take(8),
  );
  expect(refunds).toHaveLength(2);
  for (const refund of refunds) {
    expect(refund.reason).toBe("convention_cancelled");
  }
});

test("completing a paid convention pays the badge fees out to the organization", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await buyBadge(t, conventionId, ticketTypeId, 1, "a");
  await buyBadge(t, conventionId, ticketTypeId, 2, "b");

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.conventions.lifecycle.completeConvention, { conventionId });
  await drainScheduler(t);

  const payout = await t.run(async (ctx) =>
    ctx.db
      .query("eventPayouts")
      .withIndex("by_conventionId", (q) => q.eq("conventionId", conventionId))
      .unique(),
  );
  expect(payout).toMatchObject({
    status: "completed",
    conventionId,
    totalEntryCents: BADGE_FEE_CENTS * 2,
    netCents: BADGE_FEE_CENTS * 2,
  });
  expect(gatewayState.transfers).toHaveLength(2);
  for (const transfer of gatewayState.transfers) {
    expect(transfer.amountCents).toBe(BADGE_FEE_CENTS);
  }
  const summary = await t
    .withIdentity(organizerIdentity)
    .query(api.payments.payouts.getConventionPayout, { conventionId });
  expect(summary?.status).toBe("completed");
});

test("the ticket price freezes once any order exists", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await insertPlayerUser(t, 1);
  await t
    .withIdentity(playerIdentity(1))
    .action(api.payments.checkout.createBadgeCheckout, {
      conventionId,
      ticketTypeId,
    });

  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.conventions.ticketTypes.updateTicketType, {
        ticketTypeId,
        name: "Weekend badge",
        priceCents: 2500,
      }),
  ).rejects.toThrow(/locked once a payment exists/);
});

test("completing straight from registration lapses open checkouts before the payout", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedPaidConvention(
    t,
    organizationId,
  );
  await buyBadge(t, conventionId, ticketTypeId, 1, "a");
  // Player 2 opens a checkout but never pays.
  await insertPlayerUser(t, 2);
  await t
    .withIdentity(playerIdentity(2))
    .action(api.payments.checkout.createBadgeCheckout, {
      conventionId,
      ticketTypeId,
    });
  const openOrder = await latestBadgeOrder(t, conventionId, 2);
  expect(openOrder.status).toBe("awaiting_payment");

  // Sales run until completion (there is no start transition, ADR 0004),
  // so the completion itself must close the live checkouts.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.conventions.lifecycle.completeConvention, { conventionId });
  await drainScheduler(t);

  const closed = await t.run(async (ctx) => ctx.db.get(openOrder._id));
  expect(closed?.status).toBe("canceled");
  expect(gatewayState.expired).toContain(openOrder.stripeCheckoutSessionId);

  // The payout covers only the paid badge, and nothing is left to block
  // deletion once it lands.
  const payout = await t.run(async (ctx) =>
    ctx.db
      .query("eventPayouts")
      .withIndex("by_conventionId", (q) => q.eq("conventionId", conventionId))
      .unique(),
  );
  expect(payout).toMatchObject({
    status: "completed",
    totalEntryCents: BADGE_FEE_CENTS,
  });
  expect(gatewayState.transfers).toHaveLength(1);
});
