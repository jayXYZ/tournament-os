/// <reference types="vite/client" />
import Stripe from "stripe";
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { patchOrder } from "./model/payments";
import {
  MAX_REFUND_ATTEMPTS,
  REFUND_CREATE_WINDOW_MS,
} from "./payments/refunds";
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
//
// The second half pins the executor's recovery contract
// (docs/refund-recovery.md): an unknown outcome parks the row, parking is
// final for automation, the owner's status check settles only from the
// refund Stripe holds for the row and creates nothing, and the guard beside
// every execution catches the one that dies without reporting.

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
  // How many create calls reached the gateway, thrown ones included.
  creates: 0,
  // Runs inside the create call, before it returns or throws. Models
  // something landing (a webhook) while an attempt is between its request
  // and its recording mutation.
  onCreateRefund: null as (() => Promise<void>) | null,
  // What Stripe reports when asked for the refund stamped with the row
  // (the owner's status check).
  existingRefund: null as {
    stripeRefundId: string;
    status: "succeeded" | "pending" | "failed";
    amountCents: number;
    failureReason: string | null;
  } | null,
  // How many times the gateway was asked.
  lookups: 0,
  findRefundError: null as Error | null,
  // Runs inside the lookup, before it returns — models something landing
  // (a webhook) while a status check is between its lookup and its write.
  onFindRefund: null as (() => Promise<void>) | null,
  // When set, the executor cannot even build its gateway — models an
  // execution dying before any Stripe call, with nothing recorded.
  secretKeyError: null as Error | null,
}));

vi.mock("./stripe/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("./stripe/config")>();
  return {
    ...original,
    requireStripeSecretKey: () => {
      if (gatewayState.secretKeyError) {
        throw gatewayState.secretKeyError;
      }
      return "rk_test_fake";
    },
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
      gatewayState.creates += 1;
      await gatewayState.onCreateRefund?.();
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
      await gatewayState.onFindRefund?.();
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
  gatewayState.creates = 0;
  gatewayState.onCreateRefund = null;
  gatewayState.existingRefund = null;
  gatewayState.lookups = 0;
  gatewayState.findRefundError = null;
  gatewayState.onFindRefund = null;
  gatewayState.secretKeyError = null;
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
    { tournamentId, now: Date.now() },
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
    { tournamentId, now: Date.now() },
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
  const refundDeadline = Date.now() - 86_400_000;
  const tournamentId = await seedPaidTournament(t, organizationId, {
    refundDeadline,
  });
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  // The verdict follows the client's clock: a client still inside the
  // window sees the full refund, one past the deadline sees none — same
  // rows, no write between the two reads.
  const insideWindow = await asPlayer.query(
    api.payments.queries.getMyEntryOrder,
    { tournamentId, now: refundDeadline - 60_000 },
  );
  expect(insideWindow?.cancelOutcome).toBe("full_refund");
  const beforeCancel = await asPlayer.query(
    api.payments.queries.getMyEntryOrder,
    { tournamentId, now: Date.now() },
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
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
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
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
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
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_recovered_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
    amountCents: 2194,
  });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

// Seeds a second organization with its own owner, for the cross-tenant
// authorization cases.
const otherOwner = {
  issuer: "https://convex.test",
  subject: "other-owner",
  tokenIdentifier: "https://convex.test|other-owner",
  email: "other@example.test",
  name: "Other Owner",
};

async function seedOtherOrganization(t: TestConvex<typeof schema>) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: otherOwner.tokenIdentifier,
      publicCode: 202,
      email: otherOwner.email,
      name: otherOwner.name,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Other Org",
      slug: "other-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      email: otherOwner.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });
  });
}

// Parks the queued refund by hand, standing in for the executor having
// exhausted its attempts (exercised for real in the exhaustion test).
async function parkByHand(
  t: TestConvex<typeof schema>,
  refundId: Id<"paymentRefunds">,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(refundId, {
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
      lastError: "socket hang up",
    });
  });
}

// The payout card's two lists as the owner sees them, first page each (the
// card pages further; the paging test covers that), and whether both are
// complete.
async function refundsOnCard(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const asOwner = t.withIdentity(organizerIdentity);
  const list = async (status: "needs_attention" | "pending") =>
    await asOwner.query(api.payments.refunds.listRefundsNeedingAttention, {
      tournamentId,
      status,
      paginationOpts: { numItems: 8, cursor: null },
    });
  const unresolved = await list("needs_attention");
  const processing = await list("pending");
  return {
    unresolved: unresolved.page,
    processing: processing.page,
    isDone: unresolved.isDone && processing.isDone,
  };
}

// A second owner of the organization: the same payments permission on the
// same refunds, under a different identity.
const secondOwner = {
  issuer: "https://convex.test",
  subject: "second-owner",
  tokenIdentifier: "https://convex.test|second-owner",
  email: "second-owner@example.test",
  name: "Second Owner",
};

async function seedSecondOwner(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: secondOwner.tokenIdentifier,
      publicCode: 303,
      email: secondOwner.email,
      name: secondOwner.name,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      email: secondOwner.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });
  });
}

// The rate limiter's typed rejection (rateLimits.convex.spec.ts has the
// buckets' own suite; here only the status check's bucket matters).
function rateLimited(name: string) {
  return expect.objectContaining({
    data: expect.objectContaining({ kind: "RateLimited", name }),
  });
}

// The scheduler's rows for one function, oldest first.
async function scheduledRows(t: TestConvex<typeof schema>, suffix: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (row) => row.name.endsWith(suffix),
    ),
  );
}

const alreadyRefunded = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "charge_already_refunded",
    message: "Charge ch_one has already been refunded.",
  });

test("a refund that exhausts its retries parks, and a status check that finds nothing leaves it parked", async () => {
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
    // Stripe may have created the refund on any of the attempts — and the
    // executor asked Stripe nothing on its own: reconciliation is the
    // owner's check and the webhook, not a sixth automatic guess.
    expect(gatewayState.creates).toBe(MAX_REFUND_ATTEMPTS);
    expect(gatewayState.lookups).toBe(0);
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
    expect(await refundsOnCard(t, tournamentId)).toMatchObject({
      unresolved: [
        {
          refundId: exhausted!._id,
          amountCents: 2194,
          attemptCount: MAX_REFUND_ATTEMPTS,
          lastError: "socket hang up",
        },
      ],
      processing: [],
      isDone: true,
    });

    // Stripe holds no refund for the row: the check says so and changes
    // nothing — not the status, not the diagnostic, not the attempt count.
    expect(
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: exhausted!._id,
      }),
    ).toEqual({ result: "unresolved" });
    expect(gatewayState.lookups).toBe(1);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
      lastError: "socket hang up",
    });

    // The lookup itself failing is reported as a failed check, likewise
    // without touching the row.
    gatewayState.findRefundError = new Error("socket hang up on lookup");
    expect(
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: exhausted!._id,
      }),
    ).toEqual({ result: "check_failed", message: "socket hang up on lookup" });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
      lastError: "socket hang up",
    });

    // Neither check scheduled anything: with Stripe back, nothing runs.
    gatewayState.createRefundError = null;
    gatewayState.findRefundError = null;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(MAX_REFUND_ATTEMPTS);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("needs_attention");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test.each([
  {
    stripeStatus: "succeeded" as const,
    check: { result: "settled", status: "succeeded" },
    row: { status: "succeeded" },
    orderStatus: "refunded",
    audits: { refund_stalled: 0, refund_failed: 0 },
  },
  {
    stripeStatus: "failed" as const,
    check: { result: "settled", status: "failed" },
    // Settled with Stripe's reason, not the stale local error.
    row: { status: "failed", lastError: "expired_or_canceled_card" },
    orderStatus: "paid",
    audits: { refund_stalled: 0, refund_failed: 1 },
  },
  {
    stripeStatus: "pending" as const,
    check: { result: "processing" },
    // Back to pending with the Stripe id, for refund.updated to settle.
    row: { status: "pending" },
    orderStatus: "paid",
    audits: { refund_stalled: 0, refund_failed: 0 },
  },
])(
  "a status check settles a parked refund from the refund Stripe holds for the row ($stripeStatus)",
  async ({ stripeStatus, check, row, orderStatus, audits }) => {
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
    await parkByHand(t, refund!._id);

    gatewayState.existingRefund = {
      stripeRefundId: "re_found",
      status: stripeStatus,
      amountCents: 2194,
      failureReason:
        stripeStatus === "failed" ? "expired_or_canceled_card" : null,
    };
    expect(
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: refund!._id,
      }),
    ).toEqual(check);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      ...row,
      stripeRefundId: "re_found",
      attemptCount: MAX_REFUND_ATTEMPTS,
    });
    expect((await latestOrder(t, tournamentId)).status).toBe(orderStatus);
    expect(await refundAuditCounts(t, tournamentId)).toEqual(audits);
    // A settled row leaves the payout card; a processing one stays on it,
    // with its check, until Stripe's final report arrives.
    expect(await refundsOnCard(t, tournamentId)).toMatchObject({
      unresolved: [],
      processing:
        stripeStatus === "pending"
          ? [{ refundId: refund!._id, status: "pending" }]
          : [],
      isDone: true,
    });
    // Settling from Stripe's record is the whole of it: no create.
    expect(gatewayState.creates).toBe(0);

    // A second check and a duplicate webhook report repeat no terminal
    // effect (one refund_failed line at most, the order unchanged).
    expect(
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: refund!._id,
      }),
    ).toEqual(check);
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_duplicate",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_found",
      refundStatus: stripeStatus,
      refundRowId: refund!._id,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject(row);
    expect((await latestOrder(t, tournamentId)).status).toBe(orderStatus);
    expect(await refundAuditCounts(t, tournamentId)).toEqual(audits);
    // A settled row is answered without asking Stripe again.
    expect(gatewayState.lookups).toBe(stripeStatus === "pending" ? 2 : 1);

    if (stripeStatus === "pending") {
      // The executor sends nothing for a row Stripe already holds a
      // refund for; the webhook finishes the job.
      await t.action(internal.payments.refunds.executeRefund, {
        refundId: refund!._id,
      });
      expect(gatewayState.creates).toBe(0);
      await t.mutation(internal.payments.refunds.handleRefundEvent, {
        stripeEventId: "evt_late_success",
        eventType: "refund.updated",
        stripeChargeId: "ch_one",
        stripeRefundId: "re_found",
        refundStatus: "succeeded",
        refundRowId: refund!._id,
        amountCents: 2194,
      });
      expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
      expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    }
  },
);

test("a settled refund is never regressed by a later failure report", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const refundId = await runQueuedRefund(t, orderId);
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");

  // A stale or contradictory failure report after success changes nothing.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_stale_failure",
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_test_1",
    refundStatus: "failed",
    refundRowId: refundId,
    amountCents: 2194,
  });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  expect(await refundAuditCounts(t, tournamentId)).toEqual({
    refund_stalled: 0,
    refund_failed: 0,
  });
  // And a check reports it as it stands, without a Stripe call.
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, { refundId }),
  ).toEqual({ result: "settled", status: "succeeded" });
  expect(gatewayState.lookups).toBe(0);
});

test("a refund whose amount disagrees with the row settles nothing, from a check or a webhook", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  // A refund stamped with the row's id but for a different amount — a
  // replacement an operator attached to the wrong row, say — is not this
  // row's refund: the check names it and leaves the row for a person.
  gatewayState.existingRefund = {
    stripeRefundId: "re_other_amount",
    status: "succeeded",
    amountCents: 1000,
    failureReason: null,
  };
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, {
      refundId: refund!._id,
    }),
  ).toEqual({
    result: "mismatch",
    stripeRefundId: "re_other_amount",
    amountCents: 1000,
  });
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_other_amount",
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_other_amount",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
    amountCents: 1000,
  });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "needs_attention",
    attemptCount: MAX_REFUND_ATTEMPTS,
    lastError: "socket hang up",
  });
  expect((await refundsFor(t, orderId))[0]!.stripeRefundId).toBeUndefined();
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
});

test("checking a refund's status is owner-only and never reaches Stripe for anyone else", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await seedOtherOrganization(t);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);
  gatewayState.existingRefund = {
    stripeRefundId: "re_found",
    status: "succeeded",
    amountCents: 2194,
    failureReason: null,
  };

  // The player whose refund it is, a signed-out caller, and the owner of
  // an unrelated organization: none may check it, and none costs a lookup.
  for (const caller of [asPlayer, t, t.withIdentity(otherOwner)]) {
    await expect(
      caller.action(api.payments.refunds.checkRefundStatus, {
        refundId: refund!._id,
      }),
    ).rejects.toThrow();
  }
  expect(gatewayState.lookups).toBe(0);
  expect((await refundsFor(t, orderId))[0]!.status).toBe("needs_attention");
});

test("a definitive rejection on the first attempt settles the refund failed", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    // Stripe received the one and only request and refused it: nothing
    // was created, so the row is a plain failure with Stripe's words.
    gatewayState.createRefundError =
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        message: "No such charge: ch_one",
      });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastError: "No such charge: ch_one",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 1,
    });
    expect(gatewayState.creates).toBe(1);
    expect(gatewayState.lookups).toBe(0);
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a definitive rejection after an uncertain attempt parks the refund instead of settling it", async () => {
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
    const [refund] = await refundsFor(t, orderId);

    // The first attempt drops its connection — the refund may exist.
    gatewayState.createRefundError = new Error("socket hang up");
    await expect(
      t.action(internal.payments.refunds.executeRefund, {
        refundId: refund!._id,
      }),
    ).rejects.toThrow("socket hang up");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
    });

    // Stripe now refuses outright — perhaps precisely because the lost
    // attempt already refunded the charge. The refusal proves this request
    // created nothing and says nothing about the earlier one, so the row
    // parks rather than settling "failed" and paying the order out.
    gatewayState.createRefundError = alreadyRefunded();
    await expect(
      t.action(internal.payments.refunds.executeRefund, {
        refundId: refund!._id,
      }),
    ).rejects.toThrow("already been refunded");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "needs_attention",
      attemptCount: 2,
      lastError: "Charge ch_one has already been refunded.",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
    expect(gatewayState.lookups).toBe(0);

    // Nothing automatic follows a park: the queued attempts and guards
    // find the row parked and stand down.
    gatewayState.createRefundError = null;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(2);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("needs_attention");

    // Stripe's own report of the lost attempt's refund settles the row.
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_lost_attempt",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_lost_attempt",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  } finally {
    vi.useRealTimers();
  }
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
  // the refund, so every one counts as a retriable attempt and the row
  // stays pending.
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

test("a recorded attempt failure schedules its own retry and the retry's guard", async () => {
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
    const guardsBefore = (await scheduledRows(t, "guardRefundExecution"))
      .length;

    // The retry rides the same transaction as the counted attempt: an
    // executor that dies right after recording can never leave a pending
    // row with a bumped counter and nothing scheduled to run it — and the
    // retry is watched like the first attempt was.
    await t.mutation(internal.payments.refunds.recordRefundAttemptFailure, {
      refundId: refund!._id,
      errorMessage: "socket hang up",
      definitive: false,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
    });
    expect((await scheduledRows(t, "guardRefundExecution")).length).toBe(
      guardsBefore + 1,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.refunds).toHaveLength(1);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  } finally {
    vi.useRealTimers();
  }
});

test("the executor sends nothing once the row's create window has closed", async () => {
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
    const [refund] = await refundsFor(t, orderId);

    // The execution lands long after it was queued (a scheduler backlog):
    // its idempotency key may have lapsed, so a replay could be a second
    // refund. It parks instead, whatever the attempt count.
    vi.setSystemTime(Date.now() + REFUND_CREATE_WINDOW_MS + 1);
    await t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    });
    expect(gatewayState.creates).toBe(0);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "needs_attention",
      attemptCount: 0,
      lastError: expect.stringContaining("retry window closed"),
    });
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
    // The originally queued execution and its guard find the row parked.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(0);
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("an execution that dies before recording anything is parked by its guard, and a later webhook settles it", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    // The execution dies before it can even build its gateway: no Stripe
    // call, no attempt recorded, a pending row nothing would revisit.
    gatewayState.secretKeyError = new Error("STRIPE_SECRET_KEY is not set");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The guard finds the execution ended and the row untouched, and
    // parks it with a diagnostic that claims no more than it knows.
    expect(gatewayState.creates).toBe(0);
    const [refund] = await refundsFor(t, orderId);
    expect(refund).toMatchObject({
      status: "needs_attention",
      attemptCount: 0,
      lastError: expect.stringContaining("ended without recording an outcome"),
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
    expect(await refundsOnCard(t, tournamentId)).toMatchObject({
      unresolved: [{ refundId: refund!._id }],
      processing: [],
      isDone: true,
    });

    // Parking is final for automation: with the fault cleared, nothing runs.
    gatewayState.secretKeyError = null;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(0);

    // The request may in truth have reached Stripe; its report settles
    // the row with the usual accounting.
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_after_crash",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_after_crash",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_after_crash",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a guard that finds its execution still queued waits instead of parking", async () => {
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
    const [refund] = await refundsFor(t, orderId);
    const [execution] = await scheduledRows(t, "executeRefund");
    expect(execution!.state.kind).toBe("pending");
    const guardsBefore = (await scheduledRows(t, "guardRefundExecution"))
      .length;

    // Run the guard early, while the execution is still in the queue: it
    // must neither park the row nor declare anything, only look again.
    await t.mutation(internal.payments.refunds.guardRefundExecution, {
      refundId: refund!._id,
      executionId: execution!._id,
      attemptCount: 0,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    expect((await scheduledRows(t, "guardRefundExecution")).length).toBe(
      guardsBefore + 1,
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect(gatewayState.creates).toBe(1);
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("an obsolete guard cannot park the attempt that superseded its execution", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    gatewayState.createRefundError = new Error("socket hang up");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    // Run only the first execution: it fails, records the attempt, and
    // queues the retry with its own guard.
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
    const [refund] = await refundsFor(t, orderId);
    expect(refund).toMatchObject({ status: "pending", attemptCount: 1 });
    const [first] = await scheduledRows(t, "executeRefund");
    expect(first!.state.kind).toBe("failed");

    // The first execution's guard, arriving now, sees a row that has
    // moved on (attempt count 1, not the 0 it was queued with) and stands
    // down — the retry is the live execution, and only its own guard may
    // judge it.
    await t.mutation(internal.payments.refunds.guardRefundExecution, {
      refundId: refund!._id,
      executionId: first!._id,
      attemptCount: 0,
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
    });
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });

    gatewayState.createRefundError = null;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect(gatewayState.creates).toBe(2);
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a refund Stripe accepted and is still processing is not mistaken for an abandoned execution", async () => {
  vi.useFakeTimers();
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    gatewayState.createRefundStatus = "pending";
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    // Execution and guard both run: the row is pending with Stripe's id,
    // which is the webhook's business, not the guard's.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [refund] = await refundsFor(t, orderId);
    expect(refund).toMatchObject({
      status: "pending",
      stripeRefundId: "re_test_1",
      attemptCount: 0,
    });
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });
    // Nor is it the executor's: a replay sends nothing.
    await t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    });
    expect(gatewayState.creates).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  {
    priorAttempts: 0,
    row: { status: "failed" },
    audits: { refund_stalled: 0, refund_failed: 1 },
  },
  {
    priorAttempts: 1,
    row: { status: "needs_attention" },
    audits: { refund_stalled: 1, refund_failed: 0 },
  },
])(
  "a missing charge is a plain failure with no attempt sent and parks after one ($priorAttempts prior)",
  async ({ priorAttempts, row, audits }) => {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);

    const orderId = await payForEntry(t, tournamentId, "one");
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    const [refund] = await refundsFor(t, orderId);
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, { attemptCount: priorAttempts });
      await patchOrder(ctx, (await ctx.db.get(orderId))!, {
        stripeChargeId: undefined,
      });
    });

    await t.action(internal.payments.refunds.executeRefund, {
      refundId: refund!._id,
    });
    expect(gatewayState.creates).toBe(0);
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      ...row,
      lastError: "The order has no Stripe charge to refund",
    });
    expect(await refundAuditCounts(t, tournamentId)).toEqual(audits);
  },
);

test("a Stripe error cached under the key replays through the budget; the check then settles from the refund it hid", async () => {
  vi.useFakeTimers();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const asPlayer = t.withIdentity(playerOne);
    const asOwner = t.withIdentity(organizerIdentity);

    const orderId = await payForEntry(t, tournamentId, "one");
    // Stripe answered the first request with a 5xx after creating the
    // refund, and replays that answer for every retry under the key: the
    // executor can never learn of the refund by retrying.
    gatewayState.createRefundError = new Stripe.errors.StripeAPIError({
      type: "api_error",
      message: "An error occurred while processing the refund.",
    });
    gatewayState.existingRefund = {
      stripeRefundId: "re_behind_500",
      status: "succeeded",
      amountCents: 2194,
      failureReason: null,
    };
    await asPlayer.mutation(
      api.tournaments.registrations.cancelMyRegistration,
      { tournamentId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [refund] = await refundsFor(t, orderId);
    expect(refund).toMatchObject({
      status: "needs_attention",
      attemptCount: MAX_REFUND_ATTEMPTS,
    });
    expect(gatewayState.creates).toBe(MAX_REFUND_ATTEMPTS);
    expect(gatewayState.lookups).toBe(0);

    // The owner's check asks Stripe's record and finds the refund the
    // cached error hid; settling it costs no create.
    expect(
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: refund!._id,
      }),
    ).toEqual({ result: "settled", status: "succeeded" });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_behind_500",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(MAX_REFUND_ATTEMPTS);
  } finally {
    vi.useRealTimers();
    consoleError.mockRestore();
  }
});

test("a webhook reporting a parked refund as processing un-parks it for the webhook to settle", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  // Stripe reports the refund a lost attempt created, still on the bank
  // rails: the money is moving, so the row is no longer an operator's
  // problem — it records the Stripe id and goes back to pending, for
  // refund.updated to settle. It stays on the payout card as processing
  // (not parked: no stall error, no destructive framing) so the owner can
  // still check it if that final webhook never comes.
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_processing",
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_processing_1",
    refundStatus: "pending",
    refundRowId: refund!._id,
    amountCents: 2194,
  });
  const [unparked] = await refundsFor(t, orderId);
  expect(unparked).toMatchObject({
    status: "pending",
    stripeRefundId: "re_processing_1",
  });
  expect(unparked!.lastError).toBeUndefined();
  expect(await refundsOnCard(t, tournamentId)).toMatchObject({
    unresolved: [],
    processing: [{ refundId: refund!._id, status: "pending", lastError: null }],
    isDone: true,
  });

  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_refund_processed",
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_processing_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
    amountCents: 2194,
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
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_override_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
    amountCents: 2194,
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
    eventType: "refund.updated",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_lost_1",
    refundStatus: "succeeded",
    refundRowId: refund!._id,
    amountCents: 2194,
  });

  const [settled] = await refundsFor(t, orderId);
  expect(settled).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_lost_1",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a processing refund the webhook never finishes stays checkable from the payout card", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  // The owner's check finds the refund still on the rails: the row
  // un-parks to pending but keeps its place on the card.
  gatewayState.existingRefund = {
    stripeRefundId: "re_slow",
    status: "pending",
    amountCents: 2194,
    failureReason: null,
  };
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, {
      refundId: refund!._id,
    }),
  ).toEqual({ result: "processing" });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "pending",
    stripeRefundId: "re_slow",
  });
  expect(await refundsOnCard(t, tournamentId)).toMatchObject({
    unresolved: [],
    processing: [{ refundId: refund!._id, status: "pending" }],
    isDone: true,
  });

  // No final webhook ever arrives; a later check settles it from the card.
  gatewayState.existingRefund = {
    stripeRefundId: "re_slow",
    status: "succeeded",
    amountCents: 2194,
    failureReason: null,
  };
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, {
      refundId: refund!._id,
    }),
  ).toEqual({ result: "settled", status: "succeeded" });
  expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  expect(await refundsOnCard(t, tournamentId)).toEqual({
    unresolved: [],
    processing: [],
    isDone: true,
  });
  expect(gatewayState.creates).toBe(0);

  // A pending row the executor is still working on (no Stripe id yet) is
  // the executor's business, not the card's.
  const secondOrderId = await payForEntry(t, tournamentId, "two");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [queued] = await refundsFor(t, secondOrderId);
  expect(queued!.status).toBe("pending");
  expect(queued!.stripeRefundId).toBeUndefined();
  expect(await refundsOnCard(t, tournamentId)).toEqual({
    unresolved: [],
    processing: [],
    isDone: true,
  });
});

test("a webhook for a refund on another charge settles nothing, even with the row's amount and stamp", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const [refund] = await refundsFor(t, orderId);
    await parkByHand(t, refund!._id);

    // A replacement an operator stamped with this row but issued against
    // the wrong charge: right amount, right metadata, not this row's money.
    for (const stripeChargeId of ["ch_other", null]) {
      await t.mutation(internal.payments.refunds.handleRefundEvent, {
        stripeEventId: `evt_wrong_charge_${stripeChargeId}`,
        eventType: "refund.updated",
        stripeChargeId,
        stripeRefundId: "re_wrong_charge",
        refundStatus: "succeeded",
        refundRowId: refund!._id,
        amountCents: 2194,
      });
      expect((await refundsFor(t, orderId))[0]).toMatchObject({
        status: "needs_attention",
        lastError: "socket hang up",
      });
      expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    }
    expect(consoleError).toHaveBeenCalledTimes(2);

    // Nor can it recover a failed row, or settle by Stripe refund id once
    // the row carries one.
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, {
        status: "failed",
        stripeRefundId: "re_right_charge",
      });
    });
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_wrong_charge_by_id",
      eventType: "refund.updated",
      stripeChargeId: "ch_other",
      stripeRefundId: "re_right_charge",
      refundStatus: "succeeded",
      refundRowId: null,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("failed");
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");

    // The refund on the row's own charge settles it.
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_right_charge",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_right_charge",
      refundStatus: "succeeded",
      refundRowId: null,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  } finally {
    consoleError.mockRestore();
  }
});

test("a stray-charge refund's webhook is matched against the row's own charge, not the order's", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const [refund] = await refundsFor(t, orderId);
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, {
        status: "needs_attention",
        stripeChargeId: "ch_stray",
      });
    });

    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_stray_on_order_charge",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_stray",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("needs_attention");

    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_stray_on_stray_charge",
      eventType: "refund.updated",
      stripeChargeId: "ch_stray",
      stripeRefundId: "re_stray",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
    expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
    // Stray money never drives the order's status.
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
  } finally {
    consoleError.mockRestore();
  }
});

test("a webhook failure settles the row with Stripe's reason, like a status check does", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_failed_with_reason",
    eventType: "refund.failed",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_failed",
    refundStatus: "failed",
    refundRowId: refund!._id,
    amountCents: 2194,
    failureReason: "expired_or_canceled_card",
  });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "failed",
    lastError: "expired_or_canceled_card",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");
  expect(await refundAuditCounts(t, tournamentId)).toEqual({
    refund_stalled: 0,
    refund_failed: 1,
  });

  // Without a reason from Stripe the stale stall error still gives way
  // (the row re-parked by hand to take a second report).
  await parkByHand(t, refund!._id);
  await t.mutation(internal.payments.refunds.handleRefundEvent, {
    stripeEventId: "evt_failed_no_reason",
    eventType: "refund.failed",
    stripeChargeId: "ch_one",
    stripeRefundId: "re_failed",
    refundStatus: "failed",
    refundRowId: null,
    amountCents: 2194,
  });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "failed",
    lastError: "Stripe reports this refund failed",
  });
});

test.each([
  {
    lookup: "finds nothing",
    existingRefund: null,
    lookupError: null,
  },
  {
    lookup: "finds a refund with another amount",
    existingRefund: {
      stripeRefundId: "re_other_amount",
      status: "succeeded" as const,
      amountCents: 1000,
      failureReason: null,
    },
    lookupError: null,
  },
  {
    lookup: "fails",
    existingRefund: null,
    lookupError: new Error("socket hang up on lookup"),
  },
])(
  "a status check whose lookup $lookup still reports a row a webhook settled mid-lookup",
  async ({ existingRefund, lookupError }) => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
      await parkByHand(t, refund!._id);

      // The lookup's answer would leave the row untouched and tell the
      // organizer to contact the operator — but the success webhook lands
      // during the lookup. The check must report the settled row, not
      // contradict it.
      gatewayState.existingRefund = existingRefund;
      gatewayState.onFindRefund = async () => {
        await t.mutation(internal.payments.refunds.handleRefundEvent, {
          stripeEventId: "evt_mid_lookup",
          eventType: "refund.updated",
          stripeChargeId: "ch_one",
          stripeRefundId: "re_racing",
          refundStatus: "succeeded",
          refundRowId: refund!._id,
          amountCents: 2194,
        });
        if (lookupError) {
          throw lookupError;
        }
      };
      expect(
        await asOwner.action(api.payments.refunds.checkRefundStatus, {
          refundId: refund!._id,
        }),
      ).toEqual({ result: "settled", status: "succeeded" });
      expect(gatewayState.lookups).toBe(1);
      expect((await refundsFor(t, orderId))[0]).toMatchObject({
        status: "succeeded",
        stripeRefundId: "re_racing",
      });
      expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
      expect(await refundsOnCard(t, tournamentId)).toEqual({
        unresolved: [],
        processing: [],
        isDone: true,
      });
    } finally {
      consoleError.mockRestore();
    }
  },
);

test("a status check reports the row as stored when a webhook settles it mid-lookup", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  // Stripe's answer to the lookup is "pending", but the success webhook
  // lands before the check writes. The row is right (succeeded, never
  // regressed), and the check must say what the row says — not replay
  // its older snapshot as "processing".
  gatewayState.existingRefund = {
    stripeRefundId: "re_racing",
    status: "pending",
    amountCents: 2194,
    failureReason: null,
  };
  gatewayState.onFindRefund = async () => {
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_mid_lookup",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_racing",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
  };
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, {
      refundId: refund!._id,
    }),
  ).toEqual({ result: "settled", status: "succeeded" });
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_racing",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  expect(await refundsOnCard(t, tournamentId)).toEqual({
    unresolved: [],
    processing: [],
    isDone: true,
  });
});

test("the payout card pages through every parked refund, and a processing refund behind them is reachable at once", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);

  // A mass stall: more parked refunds than one page holds (a Stripe outage
  // mid-sweep), then — queued after every one of them — a refund Stripe is
  // still processing, and one the executor has not sent yet.
  const PARKED = 70;
  const { processingId, queuedId } = await t.run(async (ctx) => {
    // Every clone refunds the one real order (orders are written only
    // through model/payments.ts); the card's lists read refunds, not orders.
    const { _id, _creationTime, ...row } = (await ctx.db.get(refund!._id))!;
    const clone = async (patch: Partial<Doc<"paymentRefunds">>) =>
      await ctx.db.insert("paymentRefunds", { ...row, ...patch });
    for (let index = 1; index < PARKED; index += 1) {
      await clone({});
    }
    const processingId = await clone({
      status: "pending",
      stripeRefundId: "re_processing_late",
      lastError: undefined,
    });
    const queuedId = await clone({
      status: "pending",
      stripeRefundId: undefined,
      lastError: undefined,
      attemptCount: 0,
    });
    return { processingId, queuedId };
  });

  const page = async (
    status: "needs_attention" | "pending",
    cursor: string | null,
    numItems = 32,
  ) =>
    await asOwner.query(api.payments.refunds.listRefundsNeedingAttention, {
      tournamentId,
      status,
      paginationOpts: { numItems, cursor },
    });

  // The parked list pages to its end, reaching every parked row once and
  // nothing else.
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    const result = await page("needs_attention", cursor);
    expect(result.page.length).toBeLessThanOrEqual(32);
    for (const row of result.page) {
      expect(row.status).toBe("needs_attention");
      expect(seen.has(row.refundId)).toBe(false);
      seen.add(row.refundId);
    }
    cursor = result.isDone ? null : result.continueCursor;
    pages += 1;
  } while (cursor !== null);
  expect(pages).toBe(3);
  expect(seen.size).toBe(PARKED);

  // The processing refund is on the card's other list straight away, not
  // behind the parked rows; the executor's own backlog is on neither.
  expect(await page("pending", null)).toMatchObject({
    page: [{ refundId: processingId, status: "pending", lastError: null }],
    isDone: true,
  });
  expect(seen.has(processingId)).toBe(false);
  expect(seen.has(queuedId)).toBe(false);

  // A page request past the cap reads the cap, no more.
  const capped = await page("needs_attention", null, 10_000);
  expect(capped.page).toHaveLength(64);
  expect(capped.isDone).toBe(false);

  // The owner settles the processing refund without touching a parked row:
  // it leaves its list, and the parked rows are all still there.
  gatewayState.existingRefund = {
    stripeRefundId: "re_processing_late",
    status: "succeeded",
    amountCents: 2194,
    failureReason: null,
  };
  expect(
    await asOwner.action(api.payments.refunds.checkRefundStatus, {
      refundId: processingId,
    }),
  ).toEqual({ result: "settled", status: "succeeded" });
  expect((await page("pending", null)).page).toEqual([]);
  const stillParked = await page("needs_attention", null, 64);
  expect(stillParked.page).toHaveLength(64);
  expect(stillParked.isDone).toBe(false);
  expect(gatewayState.creates).toBe(0);
});

test("status checks are metered per caller: a refused check never reaches Stripe, and the settled-meanwhile re-read costs nothing", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await seedSecondOwner(t, organizationId);
  const asPlayer = t.withIdentity(playerOne);
  const asOwner = t.withIdentity(organizerIdentity);
  const asSecondOwner = t.withIdentity(secondOwner);

  const orderId = await payForEntry(t, tournamentId, "one");
  await asPlayer.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const [refund] = await refundsFor(t, orderId);
  await parkByHand(t, refund!._id);
  const check = async (caller: typeof asOwner) =>
    await caller.action(api.payments.refunds.checkRefundStatus, {
      refundId: refund!._id,
    });

  // The bucket's whole capacity (40, rateLimits.ts) goes to lookups, one
  // each; the next check is refused before Stripe is asked, with the row
  // exactly as it was.
  for (let index = 0; index < 40; index += 1) {
    expect(await check(asOwner)).toEqual({ result: "unresolved" });
  }
  expect(gatewayState.lookups).toBe(40);
  await expect(check(asOwner)).rejects.toEqual(
    rateLimited("checkRefundStatus"),
  );
  expect(gatewayState.lookups).toBe(40);
  expect((await refundsFor(t, orderId))[0]).toMatchObject({
    status: "needs_attention",
    attemptCount: MAX_REFUND_ATTEMPTS,
    lastError: "socket hang up",
  });

  // Buckets are per identity: another owner of the same organization is
  // not starved by the first.
  expect(await check(asSecondOwner)).toEqual({ result: "unresolved" });
  expect(gatewayState.lookups).toBe(41);

  // A check pays once. On the second owner's last token, a webhook settles
  // the row while the lookup is in flight: the check reports the
  // settlement from its re-read rather than failing a second debit.
  for (let index = 1; index < 39; index += 1) {
    expect(await check(asSecondOwner)).toEqual({ result: "unresolved" });
  }
  gatewayState.onFindRefund = async () => {
    await t.mutation(internal.payments.refunds.handleRefundEvent, {
      stripeEventId: "evt_mid_lookup",
      eventType: "refund.updated",
      stripeChargeId: "ch_one",
      stripeRefundId: "re_mid_lookup",
      refundStatus: "succeeded",
      refundRowId: refund!._id,
      amountCents: 2194,
    });
  };
  expect(await check(asSecondOwner)).toEqual({
    result: "settled",
    status: "succeeded",
  });
  expect(gatewayState.lookups).toBe(80);
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
  // The bucket is now empty: even the settled row's Stripe-free answer
  // waits for a token.
  await expect(check(asSecondOwner)).rejects.toEqual(
    rateLimited("checkRefundStatus"),
  );
  expect(gatewayState.lookups).toBe(80);
});

test.each([
  { priorAttempts: 0, definitive: false },
  { priorAttempts: 1, definitive: true },
  { priorAttempts: MAX_REFUND_ATTEMPTS - 1, definitive: false },
])(
  "a thrown attempt neither counts, retries nor parks once a webhook has bound the refund Stripe holds ($priorAttempts prior, definitive $definitive)",
  async ({ priorAttempts, definitive }) => {
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
      const [refund] = await refundsFor(t, orderId);
      await t.run(async (ctx) => {
        await ctx.db.patch(refund!._id, {
          attemptCount: priorAttempts,
          lastError: priorAttempts > 0 ? "socket hang up" : undefined,
        });
      });
      const executionsBefore = (await scheduledRows(t, "executeRefund")).length;
      const guardsBefore = (await scheduledRows(t, "guardRefundExecution"))
        .length;

      // The request reaches Stripe and creates the refund, but its response
      // is lost: Stripe's processing webhook lands before the thrown call
      // is recorded. On the last attempt the old recorder would have parked
      // a refund in flight; on a definitive rejection after an earlier
      // attempt, likewise; on an early attempt it would have scheduled a
      // retry with nothing to send.
      gatewayState.createRefundError = definitive
        ? alreadyRefunded()
        : new Error("socket hang up");
      gatewayState.onCreateRefund = async () => {
        await t.mutation(internal.payments.refunds.handleRefundEvent, {
          stripeEventId: "evt_processing_before_failure",
          eventType: "refund.updated",
          stripeChargeId: "ch_one",
          stripeRefundId: "re_in_flight",
          refundStatus: "pending",
          refundRowId: refund!._id,
          amountCents: 2194,
        });
      };
      await expect(
        t.action(internal.payments.refunds.executeRefund, {
          refundId: refund!._id,
        }),
      ).rejects.toThrow();
      expect(gatewayState.creates).toBe(1);

      // The row is exactly as the webhook left it: pending with the Stripe
      // id, no counted attempt, no stale error, nothing more scheduled, no
      // stall and no failure on the audit trail, processing on the card.
      const [inFlight] = await refundsFor(t, orderId);
      expect(inFlight).toMatchObject({
        status: "pending",
        stripeRefundId: "re_in_flight",
        attemptCount: priorAttempts,
      });
      expect(inFlight!.lastError).toBeUndefined();
      expect((await scheduledRows(t, "executeRefund")).length).toBe(
        executionsBefore,
      );
      expect((await scheduledRows(t, "guardRefundExecution")).length).toBe(
        guardsBefore,
      );
      expect(await refundAuditCounts(t, tournamentId)).toEqual({
        refund_stalled: 0,
        refund_failed: 0,
      });
      expect(await refundsOnCard(t, tournamentId)).toMatchObject({
        unresolved: [],
        processing: [{ refundId: refund!._id, status: "pending" }],
        isDone: true,
      });

      // What was already queued sends nothing either, and its guard stands
      // down: the row is Stripe's to finish, and the webhook finishes it.
      // (Counted per row: an earlier test's queued execution can fire
      // during this one and reach the shared gateway.)
      gatewayState.createRefundError = null;
      gatewayState.onCreateRefund = null;
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(
        gatewayState.refunds.filter((row) => row.refundRowId === refund!._id),
      ).toEqual([]);
      expect((await refundsFor(t, orderId))[0]).toMatchObject({
        status: "pending",
        stripeRefundId: "re_in_flight",
        attemptCount: priorAttempts,
      });
      await t.mutation(internal.payments.refunds.handleRefundEvent, {
        stripeEventId: "evt_in_flight_succeeded",
        eventType: "refund.updated",
        stripeChargeId: "ch_one",
        stripeRefundId: "re_in_flight",
        refundStatus: "succeeded",
        refundRowId: refund!._id,
        amountCents: 2194,
      });
      expect((await refundsFor(t, orderId))[0]!.status).toBe("succeeded");
      expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
      expect(await refundAuditCounts(t, tournamentId)).toEqual({
        refund_stalled: 0,
        refund_failed: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  },
);

test("a second refund stamped with the row never replaces, settles or recovers the one the row holds", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const [refund] = await refundsFor(t, orderId);
    // A partial refund: two of them fit under the charge, so Stripe accepts
    // a second one issued against the same charge for the row's amount and
    // stamped with the row. By charge, amount and stamp it passes for the
    // row's; only its id says it is not.
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, { amountCents: 1000 });
    });
    const report = async (
      suffix: string,
      stripeRefundId: string,
      refundStatus: "pending" | "succeeded" | "failed",
    ) =>
      await t.mutation(internal.payments.refunds.handleRefundEvent, {
        stripeEventId: `evt_${suffix}`,
        eventType: "refund.updated",
        stripeChargeId: "ch_one",
        stripeRefundId,
        refundStatus,
        refundRowId: refund!._id,
        amountCents: 1000,
      });

    // The executor's write was lost; the webhook binds the original by
    // the row's stamp.
    await report("original_processing", "re_original", "pending");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });

    // The second refund's lifecycle, matched to the row by its stamp
    // alone: neither its processing nor its success touches the row or
    // the order.
    await report("second_processing", "re_second", "pending");
    await report("second_succeeded", "re_second", "succeeded");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(consoleError).toHaveBeenCalledTimes(2);

    // The original's own reports still move the row: its failure settles
    // the row, the second refund's success cannot recover it, and a later
    // success for the original itself does.
    await report("original_failed", "re_original", "failed");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "failed",
      stripeRefundId: "re_original",
    });
    await report("second_succeeded_again", "re_second", "succeeded");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "failed",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    await report("original_succeeded", "re_original", "succeeded");
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe(
      "partially_refunded",
    );
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 1,
    });
    expect(consoleError).toHaveBeenCalledTimes(3);
  } finally {
    consoleError.mockRestore();
  }
});

test("a status check that finds a second refund stamped with the row reports a conflict and writes nothing, even against a binding that landed mid-lookup", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    await t.run(async (ctx) => {
      await ctx.db.patch(refund!._id, { amountCents: 1000 });
    });
    await parkByHand(t, refund!._id);
    const check = async () =>
      await asOwner.action(api.payments.refunds.checkRefundStatus, {
        refundId: refund!._id,
      });

    // Stripe lists a charge's refunds newest first, so the lookup takes
    // the second refund (an operator's, already succeeded) over the
    // original; and the original's processing webhook (the executor's
    // lost write, recovered by the stamp) lands while the lookup is in
    // flight. The write refuses the lookup's refund against the one the
    // row now holds, so the check cannot settle the row from the second
    // refund, and reports the two.
    gatewayState.existingRefund = {
      stripeRefundId: "re_second",
      status: "succeeded",
      amountCents: 1000,
      failureReason: null,
    };
    gatewayState.onFindRefund = async () => {
      await t.mutation(internal.payments.refunds.handleRefundEvent, {
        stripeEventId: "evt_bound_mid_lookup",
        eventType: "refund.updated",
        stripeChargeId: "ch_one",
        stripeRefundId: "re_original",
        refundStatus: "pending",
        refundRowId: refund!._id,
        amountCents: 1000,
      });
    };
    expect(await check()).toEqual({
      result: "conflict",
      stripeRefundId: "re_second",
      rowStripeRefundId: "re_original",
    });
    const [bound] = await refundsFor(t, orderId);
    expect(bound).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
      attemptCount: MAX_REFUND_ATTEMPTS,
    });
    expect(bound!.lastError).toBeUndefined();
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 0,
      refund_failed: 0,
    });
    expect(await refundsOnCard(t, tournamentId)).toMatchObject({
      unresolved: [],
      processing: [{ refundId: refund!._id, status: "pending" }],
      isDone: true,
    });

    // With nothing racing, the same lookup gets the same answer and the
    // row stays the original's.
    gatewayState.onFindRefund = null;
    expect(await check()).toEqual({
      result: "conflict",
      stripeRefundId: "re_second",
      rowStripeRefundId: "re_original",
    });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });

    // A lookup that finds the row's own refund settles it as ever.
    gatewayState.existingRefund = {
      stripeRefundId: "re_original",
      status: "succeeded",
      amountCents: 1000,
      failureReason: null,
    };
    expect(await check()).toEqual({ result: "settled", status: "succeeded" });
    expect((await refundsFor(t, orderId))[0]).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe(
      "partially_refunded",
    );
    expect(gatewayState.lookups).toBe(3);
    expect(gatewayState.creates).toBe(0);
    expect(consoleError).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});
