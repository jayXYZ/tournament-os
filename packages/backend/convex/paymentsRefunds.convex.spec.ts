/// <reference types="vite/client" />
import Stripe from "stripe";
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_REFUND_ATTEMPTS } from "./payments/refunds";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// Refund rules on the roster verbs: a player's pre-deadline cancel refunds
// in full and flags them, their repeat cancel refunds the entry cost only,
// an organizer removal always refunds in full without flagging, a
// past-deadline cancel refunds nothing, and webhook reconciliation recovers
// a lost executor write. Around them, the money-per-seat invariants: a
// second exit never double-refunds, a restore only reseats an entry whose
// order is still paid (otherwise it re-requests payment), a waitlist hold
// closes the open checkout, and a refund's local failure never outranks
// Stripe's report that the money moved.

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
  // When set, createRefund throws instead of returning — models the call
  // failing (a connection drop, a Stripe rejection).
  createRefundError: null as Error | null,
  // What Stripe reports when the executor asks whether an earlier attempt
  // for the row already refunded the charge (on a re-drive, a definitive
  // rejection, or the final retry).
  existingRefund: null as {
    stripeRefundId: string;
    status: "succeeded" | "pending" | "failed";
    failureReason: string | null;
  } | null,
  // How many times the executor asked.
  lookups: 0,
  findRefundError: null as Error | null,
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
      if (gatewayState.createRefundError) {
        throw gatewayState.createRefundError;
      }
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: gatewayState.createRefundStatus,
      };
    },
    findRefundForRow: async () => {
      gatewayState.lookups += 1;
      if (gatewayState.findRefundError) {
        throw gatewayState.findRefundError;
      }
      return gatewayState.existingRefund;
    },
  }),
}));

beforeEach(() => {
  gatewayState.refunds = [];
  gatewayState.expired = [];
  gatewayState.nextSessionNumber = 1;
  gatewayState.createRefundStatus = "succeeded";
  gatewayState.createRefundError = null;
  gatewayState.existingRefund = null;
  gatewayState.lookups = 0;
  gatewayState.findRefundError = null;
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
      country: "us",
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

// How the refund's lifecycle landed on the tournament's audit trail: a stall
// (executor gave up, outcome unknown) versus a failure (Stripe returned
// nothing), each expected at most once per refund.
async function refundAuditCounts(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const types = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event.type),
  );
  return {
    refund_stalled: types.filter((type) => type === "refund_stalled").length,
    refund_failed: types.filter((type) => type === "refund_failed").length,
  };
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

test("a second exit on the same registration never queues a duplicate refund", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  expect(await refundsFor(t, orderId)).toHaveLength(1);

  // The player's refund is still pending, so the order is still "paid" —
  // the organizer barring the cancelled row must not refund it again.
  const registrationId = (await t.run(
    async (ctx) => (await ctx.db.get(orderId))!.registrationId,
  )) as Id<"tournamentRegistrations">;
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.registrations.rejectRegistration, {
      registrationId,
    });

  const refunds = await refundsFor(t, orderId);
  expect(refunds).toHaveLength(1);
  expect(refunds[0]!.reason).toBe("player_cancel");
});

test("restoring a refunded entry re-requests payment instead of reseating for free", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  await runQueuedRefund(t, orderId);
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");

  const registrationId = (await t.run(
    async (ctx) => (await ctx.db.get(orderId))!.registrationId,
  )) as Id<"tournamentRegistrations">;
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.registrations.reinstateRegistration, {
      registrationId,
    });

  // The money left with the cancellation, so the restore lands in "pending"
  // with a fresh payable order — no seat until the Checkout webhook seats
  // the new payment.
  const registration = await t.run(
    async (ctx) => (await ctx.db.get(registrationId))!,
  );
  expect(registration.entryStatus).toBe("pending");
  const order = await latestOrder(t, tournamentId);
  expect(order).toMatchObject({
    status: "requires_payment",
    purpose: "post_approval",
  });
  const tournament = await t.run(
    async (ctx) => (await ctx.db.get(tournamentId))!,
  );
  expect(tournament.confirmedRegistrationCount).toBe(0);
});

test("restoring an entry whose order is still paid and unrefunded reseats directly", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId, {
    refundDeadline: Date.now() - 86_400_000,
  });
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  // Past the deadline the cancel refunds nothing — the money stayed.
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  expect(await refundsFor(t, orderId)).toHaveLength(0);

  const registrationId = (await t.run(
    async (ctx) => (await ctx.db.get(orderId))!.registrationId,
  )) as Id<"tournamentRegistrations">;
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.registrations.reinstateRegistration, {
      registrationId,
    });

  const registration = await t.run(
    async (ctx) => (await ctx.db.get(registrationId))!,
  );
  expect(registration.entryStatus).toBe("confirmed");
  const tournament = await t.run(
    async (ctx) => (await ctx.db.get(tournamentId))!,
  );
  expect(tournament.confirmedRegistrationCount).toBe(1);
});

test("waitlisting a pending paid application closes its open order and expires the session", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);

    // The player is mid-checkout: registration pending, order awaiting
    // payment on a live session.
    await t
      .withIdentity(playerOne)
      .action(api.payments.checkout.createEntryCheckout, { tournamentId });
    const order = await latestOrder(t, tournamentId);
    expect(order.status).toBe("awaiting_payment");

    await t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.registrations.waitlistRegistration, {
        registrationId: order.registrationId as Id<"tournamentRegistrations">,
      });

    const closed = await latestOrder(t, tournamentId);
    expect(closed.status).toBe("canceled");
    expect(await refundsFor(t, order._id)).toHaveLength(0);

    // The session expiry rides the scheduler; flush it to see the call.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.expired).toContain(order.stripeCheckoutSessionId);
  } finally {
    vi.useRealTimers();
  }
});

test("an ambiguous createRefund failure leaves the row pending for the webhook to settle", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });

  // A connection drop after Stripe may have accepted the refund: the row
  // must NOT settle as failed, or the order stays "paid" into the payout
  // while the money already went back.
  gatewayState.createRefundError = new Error("socket hang up");
  const [refund] = await refundsFor(t, orderId);
  await expect(
    t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    }),
  ).rejects.toThrow("socket hang up");
  expect((await refundsFor(t, orderId))[0]!.status).toBe("pending");

  // The refund.updated webhook carries the truth and settles the row.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_recover",
    stripeRefundId: "re_recovered_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
  });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a refund that exhausts its retries parks in needs_attention and an organizer re-drive settles it", async () => {
  vi.useFakeTimers();
  // The failing scheduled executor logs every attempt; keep the run quiet.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    // Every attempt drops the connection: the executor retries under the
    // row's idempotency key until its attempt budget runs out.
    gatewayState.createRefundError = new Error("socket hang up");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The dead end is recorded on the row — never settled "failed", since
    // Stripe may have created the refund on any of the attempts. Before
    // parking, the final attempt asked Stripe's record once; it held
    // nothing, so the player is still owed the refund and the row waits
    // for an operator.
    expect(gatewayState.lookups).toBe(1);
    const [exhausted] = await refundsFor(t, orderId);
    expect(exhausted).toMatchObject({
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
      lastError: "socket hang up",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    // The stall is on the record, but not as a failure: the money may yet
    // prove to have moved.
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
    expect(
      await asOwner.query(api.payments.refunds.listRefundsNeedingAttention, {
        tournamentId,
      }),
    ).toMatchObject({
      refunds: [
        {
          refundId: exhausted!._id,
          amountCents: 2194,
          attemptCount: MAX_REFUND_ATTEMPTS,
          lastError: "socket hang up",
        },
      ],
      hasMore: false,
    });

    // A re-drive resets the budget and the executor runs again under the
    // same idempotency key; with Stripe reachable the refund settles.
    gatewayState.createRefundError = null;
    await asOwner.mutation(api.payments.refunds.retryRefund, {
      refundId: exhausted!._id,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    expect(gatewayState.refunds).toHaveLength(1);

    // A settled row is not retriable again.
    await expect(
      asOwner.mutation(api.payments.refunds.retryRefund, {
        refundId: exhausted!._id,
      }),
    ).rejects.toThrow("not awaiting a retry");
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

// A re-drive can land days after the stalled attempts, past the life of
// their idempotency key, so the executor asks Stripe for the row's refund
// before creating one and settles from that record — never from a guess
// about the lost earlier attempts.
//
// Exhausts the queued executor for real (fake timers required): every
// attempt drops the connection until the row parks, then the gateway state
// is restored and the lookup counter reset so the test observes only the
// re-drive's own calls.
async function parkExhaustedRefund(
  t: TestConvex<typeof schema>,
  refundId: Id<"paymentRefunds">,
) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const previous = {
    createRefundError: gatewayState.createRefundError,
    existingRefund: gatewayState.existingRefund,
  };
  gatewayState.createRefundError = new Error("socket hang up");
  gatewayState.existingRefund = null;
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    consoleError.mockRestore();
    gatewayState.createRefundError = previous.createRefundError;
    gatewayState.existingRefund = previous.existingRefund;
    gatewayState.lookups = 0;
  }
  const parked = await t.run(async (ctx) => await ctx.db.get(refundId));
  expect(parked).toMatchObject({
    status: "needs_attention",
    attemptCount: MAX_REFUND_ATTEMPTS,
  });
}

const alreadyRefunded = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "charge_already_refunded",
    message: "Charge ch_one has already been refunded.",
  });

test("a re-drive settles from the refund an earlier attempt created without calling create again", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    const [refund] = await refundsFor(t, orderId);
    await parkExhaustedRefund(t, refund!._id);

    // Days later the idempotency key has expired; a replayed create would
    // be a fresh request. The re-drive asks Stripe for the row's refund
    // first and finds the one a lost attempt created — settled from it,
    // no create call, no second operator step.
    gatewayState.createRefundError = alreadyRefunded();
    gatewayState.existingRefund = {
      stripeRefundId: "re_late_1",
      status: "succeeded",
      failureReason: null,
    };
    await asOwner.mutation(api.payments.refunds.retryRefund, {
      refundId: refund!._id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_late_1",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    expect(gatewayState.refunds).toHaveLength(0);
    expect(gatewayState.lookups).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test("a re-drive whose earlier refund is still processing leaves the row pending for the webhook", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    const [refund] = await refundsFor(t, orderId);
    await parkExhaustedRefund(t, refund!._id);

    gatewayState.existingRefund = {
      stripeRefundId: "re_late_2",
      status: "pending",
      failureReason: null,
    };
    await asOwner.mutation(api.payments.refunds.retryRefund, {
      refundId: refund!._id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // Stripe's refund id is recorded so refund.updated can find the row.
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      stripeRefundId: "re_late_2",
    });
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_refund_late",
      stripeRefundId: "re_late_2",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  } finally {
    vi.useRealTimers();
  }
});

test("a definitive rejection with no refund on the charge settles a re-driven row failed, logged once", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    // Exhaust for real so the stall is on the audit log.
    gatewayState.createRefundError = new Error("socket hang up");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [refund] = await refundsFor(t, orderId);
    expect(refund!.status).toBe("needs_attention");

    // Stripe refuses the re-drive (the charge was disputed, say) and holds
    // no refund for this row: the money provably never moved, so the row
    // settles failed and the payout can proceed — no permanent parking.
    gatewayState.createRefundError =
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "charge_disputed",
        message: "Charge ch_one has been charged back; cannot issue a refund.",
      });
    await asOwner.mutation(api.payments.refunds.retryRefund, {
      refundId: refund!._id,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "failed",
      lastError: "Charge ch_one has been charged back; cannot issue a refund.",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    // One stall, one failure — not a failure line per attempt.
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 1,
    });
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a definitive rejection whose Stripe lookup fails is retried like an ambiguous failure", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  // Stripe refused the create, but the follow-up lookup dropped: without
  // Stripe's answer the row must not settle either way.
  gatewayState.createRefundError = alreadyRefunded();
  gatewayState.findRefundError = new Error("socket hang up");
  const [refund] = await refundsFor(t, orderId);
  await expect(
    t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    }),
  ).rejects.toThrow("already been refunded");
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "pending",
    attemptCount: 1,
    lastError:
      "Charge ch_one has already been refunded. (refund lookup failed: socket hang up)",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
});

test("a definitive rejection on a first-run refund settles it failed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  gatewayState.createRefundError = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message: "No such charge: ch_one",
  });
  const [refund] = await refundsFor(t, orderId);
  await expect(
    t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    }),
  ).rejects.toThrow("No such charge");
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "failed",
    lastError: "No such charge: ch_one",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
  expect(await refundAuditCounts(t, tournamentId)).toEqual({
    refund_stalled: 0,
    refund_failed: 1,
  });
});

test("a definitive rejection on a first-run refund settles from the refund Stripe holds for the row", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  // Stripe refuses the create but holds a refund stamped with this row (a
  // lost attempt landed): the row settles from that record, not "failed".
  gatewayState.createRefundError = alreadyRefunded();
  gatewayState.existingRefund = {
    stripeRefundId: "re_found_1",
    status: "succeeded",
    failureReason: null,
  };
  const [refund] = await refundsFor(t, orderId);
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_found_1",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a definitive rejection explained by a failed earlier refund carries Stripe's reason", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  gatewayState.createRefundError = alreadyRefunded();
  gatewayState.existingRefund = {
    stripeRefundId: "re_found_failed",
    status: "failed",
    failureReason: "expired_or_canceled_card",
  };
  const [refund] = await refundsFor(t, orderId);
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  // The row settles failed with Stripe's reason — not the rejection text,
  // and not whatever stale error the row carried before.
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "failed",
    stripeRefundId: "re_found_failed",
    lastError: "expired_or_canceled_card",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
  expect(await refundAuditCounts(t, tournamentId)).toEqual({
    refund_stalled: 0,
    refund_failed: 1,
  });
});

test("a rate limit, an authentication error and a permission error are retried, never settled", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);

  // Each is a 4xx that created nothing, but each clears on its own (a
  // burst subsides, a rotated key lands): settling "failed" would strand
  // the refund with no re-drive, so every one counts as a retriable
  // attempt and the row stays pending.
  const transient = [
    new Stripe.errors.StripeRateLimitError({
      type: "rate_limit_error",
      message: "Too many requests",
    }),
    new Stripe.errors.StripeAuthenticationError({
      type: "authentication_error",
      message: "Invalid API key",
    }),
    new Stripe.errors.StripePermissionError({
      type: "invalid_request_error",
      message: "This key lacks the refunds permission",
    }),
  ];
  for (const [index, error] of transient.entries()) {
    gatewayState.createRefundError = error;
    await expect(
      t.action(internal.payments.refunds.executeRefund, {
        refundId: refund!._id,
      }),
    ).rejects.toThrow(error.message);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: index + 1,
      lastError: error.message,
    });
  }
  expect(gatewayState.lookups).toBe(0);
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
  expect(await refundAuditCounts(t, tournamentId)).toEqual({
    refund_stalled: 0,
    refund_failed: 0,
  });
});

test("a recorded attempt failure schedules its own retry", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    // Drain the queued first attempt so only the recorded failure's own
    // retry is left to observe.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [refund] = await refundsFor(t, orderId);
    expect(refund!.status).toBe("succeeded");
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, {
        status: "pending",
        stripeRefundId: undefined,
      });
    });
    gatewayState.refunds = [];

    // The retry rides the same transaction as the counted attempt: an
    // executor that dies right after recording can never leave a pending
    // row with a bumped counter and nothing scheduled to run it.
    await t.mutation(internal.payments.refunds.recordRefundAttemptFailure, {
      refundId: refund!._id,
      errorMessage: "socket hang up",
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.refunds).toHaveLength(1);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  } finally {
    vi.useRealTimers();
  }
});

test("the final retry settles from the refund a lost attempt created instead of parking", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    // Every create drops its response, but the first one did reach Stripe:
    // the refund exists under this row's id. Before giving up, the final
    // attempt asks Stripe's record and settles from it — no parking, no
    // stall on the audit log, no operator click.
    gatewayState.createRefundError = new Error("socket hang up");
    gatewayState.existingRefund = {
      stripeRefundId: "re_lost_attempt",
      status: "succeeded",
      failureReason: null,
    };
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_lost_attempt",
      attemptCount: MAX_REFUND_ATTEMPTS - 1,
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    // Only the final attempt asked; the earlier retries replayed the
    // create under its idempotency key.
    expect(gatewayState.lookups).toBe(1);
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });
    expect(
      await t
        .withIdentity(organizerIdentity)
        .query(api.payments.refunds.listRefundsNeedingAttention, {
          tournamentId,
        }),
    ).toEqual({ refunds: [], hasMore: false });
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("the final retry settles failed with Stripe's reason when the lost attempt's refund failed", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    gatewayState.createRefundError = new Error("socket hang up");
    gatewayState.existingRefund = {
      stripeRefundId: "re_lost_failed",
      status: "failed",
      failureReason: "insufficient_funds",
    };
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "failed",
      stripeRefundId: "re_lost_failed",
      lastError: "insufficient_funds",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 1,
    });
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a webhook reporting a parked refund as processing un-parks it for the webhook to settle", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    const [refund] = await refundsFor(t, orderId);
    await parkExhaustedRefund(t, refund!._id);

    // Stripe reports the refund a lost attempt created, still on the bank
    // rails: the money is moving, so the row is no longer an operator's
    // problem — it records the Stripe id and goes back to pending, off the
    // needs-attention list, for refund.updated to settle.
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_refund_processing",
      stripeRefundId: "re_processing_1",
      refundStatus: "pending",
      refundRowId: refund!._id,
    });
    const [unparked] = await refundsFor(t, orderId);
    expect(unparked).toMatchObject({
      status: "pending",
      stripeRefundId: "re_processing_1",
    });
    expect(unparked!.lastError).toBeUndefined();
    expect(
      await asOwner.query(api.payments.refunds.listRefundsNeedingAttention, {
        tournamentId,
      }),
    ).toEqual({ refunds: [], hasMore: false });
    await expect(
      asOwner.mutation(api.payments.refunds.retryRefund, {
        refundId: refund!._id,
      }),
    ).rejects.toThrow("not awaiting a retry");

    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_refund_processed",
      stripeRefundId: "re_processing_1",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  } finally {
    vi.useRealTimers();
  }
});

test("a webhook report settles a needs_attention refund without an operator", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await t.run(async (ctx) => {
    await ctx.db.patch(refund!._id, {
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
      lastError: "socket hang up",
    });
  });

  // Stripe did create the refund on one of the dropped attempts: its
  // refund.updated event is the truth and settles the parked row.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_parked",
    stripeRefundId: "re_parked_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
  });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a webhook success recovers a refund row wrongly settled as failed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await t.run(async (ctx) => {
    await ctx.db.patch(refund!._id, { status: "failed" });
  });

  // Stripe's succeeded event is proof the money moved; it outranks the
  // local failure and flips the order off "paid" so the payout skips it.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_override",
    stripeRefundId: "re_override_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
  });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
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
