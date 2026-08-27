/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// Paid registration end to end at the mutation level: checkout begin/attach,
// webhook fulfillment with the capacity re-check, expiry, the approval-mode
// pay-after-approval flow, and the fee freeze. The Stripe gateway is mocked;
// every state change under test is a Convex mutation.

const gatewayState = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  expired: [] as Array<string>,
  refunds: [] as Array<{ chargeId: string; amountCents: number }>,
  nextSessionNumber: 1,
  // When set, expireCheckoutSession throws and the status probe reports this
  // value — simulating a session Stripe refuses to expire.
  unexpirableStatus: null as "open" | "complete" | null,
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
      if (gatewayState.unexpirableStatus) {
        throw new Error("This Checkout Session cannot be expired");
      }
      gatewayState.expired.push(args.sessionId);
    },
    retrieveCheckoutSessionStatus: async () =>
      gatewayState.unexpirableStatus ?? "expired",
    createRefund: async (args: { chargeId: string; amountCents: number }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: "succeeded" as const,
      };
    },
  }),
}));

beforeEach(() => {
  gatewayState.sessions = [];
  gatewayState.expired = [];
  gatewayState.refunds = [];
  gatewayState.nextSessionNumber = 1;
  gatewayState.unexpirableStatus = null;
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

async function seedPaidTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: { playerCapacity?: number; requiresApproval?: boolean },
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
      name: "Paid Cup",
      startDate: START_DATE,
      playerCapacity: overrides?.playerCapacity ?? 16,
      format: "modern",
      isTestEvent: false,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await asOwner.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2000,
    registrationRequiresApproval: overrides?.requiresApproval ?? false,
  });
  await asOwner.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

async function latestOrderFor(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  playerN: number,
): Promise<Doc<"paymentOrders">> {
  return await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", playerIdentity(playerN).tokenIdentifier),
      )
      .unique();
    const participant = await ctx.db
      .query("participants")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    const registration = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_participantId", (q) =>
        q
          .eq("tournamentId", tournamentId)
          .eq("participantId", participant!._id),
      )
      .unique();
    const orders = await ctx.db
      .query("paymentOrders")
      .withIndex("by_registrationId", (q) =>
        q.eq("registrationId", registration!._id),
      )
      .order("desc")
      .take(8);
    return orders[0]!;
  });
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

async function tournamentDoc(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => (await ctx.db.get(tournamentId))!);
}

test("registerSelf refuses direct registration on a paid event", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.registrations.registerSelf, { tournamentId }),
  ).rejects.toThrow("register through the payment checkout");
});

test("direct paid registration: checkout, webhook confirm, idempotent redelivery", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  const { url } = await asPlayer.action(
    api.payments.checkout.createEntryCheckout,
    { tournamentId },
  );
  expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

  // Session created with the plan's separate-charges shape.
  const sessionArgs = gatewayState.sessions[0]!;
  expect(sessionArgs.totalCents).toBe(2194);
  expect(sessionArgs.transferGroup).toMatch(/^order:/);
  expect(sessionArgs.successUrl).toContain(
    "/payment?session_id={CHECKOUT_SESSION_ID}",
  );

  let order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("awaiting_payment");
  expect(order.amountBreakdown).toMatchObject({
    entryFeeCents: 2000,
    platformFeeCents: 100,
    processingFeeCents: 94,
    totalCents: 2194,
  });
  const beforeConfirm = await tournamentDoc(t, tournamentId);
  expect(beforeConfirm.confirmedRegistrationCount).toBe(0);

  await completePayment(t, order, "one");
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("paid");
  expect(order.stripeChargeId).toBe("ch_one");

  const registration = await t.run(
    async (ctx) => (await ctx.db.get(order.registrationId))!,
  );
  expect(registration.entryStatus).toBe("confirmed");
  expect(registration.participationStatus).toBe("active");
  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(1);

  // Redelivery of the same event id is an exact no-op.
  await completePayment(t, order, "one");
  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(1);

  const auditTypes = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event.type),
  );
  expect(auditTypes).toContain("payment_completed");
  expect(auditTypes).toContain("player_registered");
});

// convex-test serializes mutations, so the race is driven as an explicit
// interleaving: all three payments complete against a two-seat field, in the
// arbitrary order the webhooks would land in. True wire-level concurrency
// reduces to exactly this — each handler is one serializable transaction.
test("capacity race: the losing payment is auto-refunded in full", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId, {
    playerCapacity: 2,
  });

  for (const n of [1, 2, 3]) {
    await insertPlayerUser(t, n);
    await t
      .withIdentity(playerIdentity(n))
      .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  }
  for (const n of [1, 2, 3]) {
    const order = await latestOrderFor(t, tournamentId, n);
    await completePayment(t, order, `p${n}`);
  }

  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(2);
  const loserOrder = await latestOrderFor(t, tournamentId, 3);
  expect(loserOrder.status).toBe("paid");
  const loserRegistration = await t.run(
    async (ctx) => (await ctx.db.get(loserOrder.registrationId))!,
  );
  expect(loserRegistration.entryStatus).toBe("cancelled");

  const refund = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", loserOrder._id))
        .take(4)
    ).at(0),
  );
  expect(refund).toMatchObject({
    kind: "full",
    reason: "seat_unavailable",
    amountCents: 2194,
    absorbedFeeCents: 0,
    status: "pending",
  });

  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  expect(gatewayState.refunds).toHaveLength(1);
  expect(gatewayState.refunds[0]).toMatchObject({
    chargeId: "ch_p3",
    amountCents: 2194,
  });
  const settledOrder = await latestOrderFor(t, tournamentId, 3);
  expect(settledOrder.status).toBe("refunded");
});

test("concurrent checkouts: the newest attempt's attach wins and the stale one is refused", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  // Both begins run before either attach — the double-click interleaving.
  const beginA = await asPlayer.mutation(
    internal.payments.checkout.beginEntryCheckout,
    { tournamentId },
  );
  const beginB = await asPlayer.mutation(
    internal.payments.checkout.beginEntryCheckout,
    { tournamentId },
  );
  expect(beginB.orderId).toBe(beginA.orderId);
  // Each begin persists its own attempt token — the Stripe idempotency
  // scope, so two attempts can never be handed the same session.
  expect(beginB.checkoutAttempt).toBe(beginA.checkoutAttempt + 1);
  expect(beginA.existingSessionId).toBeNull();
  expect(beginB.existingSessionId).toBeNull();

  const attachedA = await t.mutation(
    internal.payments.checkout.attachCheckoutSession,
    {
      orderId: beginA.orderId,
      stripeCheckoutSessionId: "cs_race_a",
      checkoutAttempt: beginA.checkoutAttempt,
    },
  );
  const attachedB = await t.mutation(
    internal.payments.checkout.attachCheckoutSession,
    {
      orderId: beginB.orderId,
      stripeCheckoutSessionId: "cs_race_b",
      checkoutAttempt: beginB.checkoutAttempt,
    },
  );
  expect(attachedA).toBe(false);
  expect(attachedB).toBe(true);

  // The winner's session survives, so its payment fulfills normally instead
  // of arriving at the webhook unrecognized.
  let order = await latestOrderFor(t, tournamentId, 1);
  expect(order.stripeCheckoutSessionId).toBe("cs_race_b");
  await completePayment(t, order, "race");
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("paid");
  const registration = await t.run(
    async (ctx) => (await ctx.db.get(order.registrationId))!,
  );
  expect(registration.entryStatus).toBe("confirmed");
});

test("a paid session the order no longer owns is refunded, never silently discarded", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  let order = await latestOrderFor(t, tournamentId, 1);
  await completePayment(t, order, "kept");
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("paid");
  expect(order.stripeChargeId).toBe("ch_kept");

  // The duplicate-session race: a second successful charge arrives for the
  // same order on a session it does not carry (the invariant-violation case
  // the checkout supersede-proof is meant to exclude). The order's own
  // payment must stand untouched and the stray money must come back.
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: "evt_stray",
    orderId: order._id,
    sessionId: "cs_stray_session",
    stripePaymentIntentId: "pi_stray",
    stripeChargeId: "ch_stray",
  });

  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("paid");
  expect(order.stripeChargeId).toBe("ch_kept");
  const registration = await t.run(
    async (ctx) => (await ctx.db.get(order.registrationId))!,
  );
  expect(registration.entryStatus).toBe("confirmed");
  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(1);

  const refunds = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(8),
  );
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({
    kind: "full",
    reason: "seat_unavailable",
    amountCents: 2194,
    stripeChargeId: "ch_stray",
    status: "pending",
  });

  // The executor refunds the stray charge, not the order's recorded one,
  // and settling it leaves the order paid.
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refunds[0]!._id,
  });
  expect(gatewayState.refunds).toHaveLength(1);
  expect(gatewayState.refunds[0]).toMatchObject({
    chargeId: "ch_stray",
    amountCents: 2194,
  });
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("paid");

  // A second completion event for the same stray charge (completed +
  // async_payment_succeeded arrive as distinct event ids) refunds once.
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: "evt_stray_redelivery",
    orderId: order._id,
    sessionId: "cs_stray_session",
    stripePaymentIntentId: "pi_stray",
    stripeChargeId: "ch_stray",
  });
  const refundsAfter = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .take(8),
  );
  expect(refundsAfter).toHaveLength(1);
});

test("attach refuses an order a webhook closed mid-flight", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  const begin = await asPlayer.mutation(
    internal.payments.checkout.beginEntryCheckout,
    { tournamentId },
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(begin.orderId, { status: "canceled" });
  });

  const attached = await t.mutation(
    internal.payments.checkout.attachCheckoutSession,
    {
      orderId: begin.orderId,
      stripeCheckoutSessionId: "cs_after_close",
      checkoutAttempt: begin.checkoutAttempt,
    },
  );
  expect(attached).toBe(false);
  const order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("canceled");
  expect(order.stripeCheckoutSessionId).toBeUndefined();
});

test("a session Stripe cannot expire blocks the replacement checkout", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  let order = await latestOrderFor(t, tournamentId, 1);
  expect(order.stripeCheckoutSessionId).toBe("cs_test_1");

  // The first session completed (payment racing the webhook), so it can
  // neither be expired nor safely replaced.
  gatewayState.unexpirableStatus = "complete";
  await expect(
    asPlayer.action(api.payments.checkout.createEntryCheckout, {
      tournamentId,
    }),
  ).rejects.toThrow("still being processed");
  expect(gatewayState.sessions).toHaveLength(1);
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.stripeCheckoutSessionId).toBe("cs_test_1");

  // Once the probe reports the session expired, the retry goes through.
  gatewayState.unexpirableStatus = null;
  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.stripeCheckoutSessionId).toBe("cs_test_2");
});

test("session expiry closes a direct registration; a fresh checkout starts over", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  let order = await latestOrderFor(t, tournamentId, 1);
  await t.mutation(internal.payments.webhooks.handleCheckoutExpired, {
    stripeEventId: "evt_expired_1",
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
  });

  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("expired");
  const registration = await t.run(
    async (ctx) => (await ctx.db.get(order.registrationId))!,
  );
  expect(registration.entryStatus).toBe("cancelled");

  // Starting over mints a fresh order on the reused registration row.
  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  const freshOrder = await latestOrderFor(t, tournamentId, 1);
  expect(freshOrder._id).not.toBe(order._id);
  expect(freshOrder.status).toBe("awaiting_payment");
});

test("approval mode: apply free, approval requests payment, payment seats", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId, {
    requiresApproval: true,
  });
  await insertPlayerUser(t, 1);
  const asPlayer = t.withIdentity(playerIdentity(1));
  const asOwner = t.withIdentity(organizerIdentity);

  // Paying before approval has nothing to pay.
  const registrationId = await asPlayer.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  await expect(
    asPlayer.action(api.payments.checkout.createEntryCheckout, {
      tournamentId,
    }),
  ).rejects.toThrow("pending organizer approval");

  await asOwner.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  const registration = await t.run(
    async (ctx) => (await ctx.db.get(registrationId))!,
  );
  expect(registration.entryStatus).toBe("pending");
  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(0);
  let order = await latestOrderFor(t, tournamentId, 1);
  expect(order).toMatchObject({
    purpose: "post_approval",
    status: "requires_payment",
  });

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("awaiting_payment");

  // Post-approval expiry keeps the approval payable.
  await t.mutation(internal.payments.webhooks.handleCheckoutExpired, {
    stripeEventId: "evt_expired_pa",
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
  });
  order = await latestOrderFor(t, tournamentId, 1);
  expect(order.status).toBe("requires_payment");
  expect(order.stripeCheckoutSessionId).toBeUndefined();

  await asPlayer.action(api.payments.checkout.createEntryCheckout, {
    tournamentId,
  });
  order = await latestOrderFor(t, tournamentId, 1);
  await completePayment(t, order, "pa");

  const seated = await t.run(
    async (ctx) => (await ctx.db.get(registrationId))!,
  );
  expect(seated.entryStatus).toBe("confirmed");
  expect(
    (await tournamentDoc(t, tournamentId)).confirmedRegistrationCount,
  ).toBe(1);
  const auditTypes = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .take(64)
    ).map((row) => row.event.type),
  );
  expect(auditTypes).toContain("payment_requested");
});

test("the entry fee freezes once an order exists", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  await insertPlayerUser(t, 1);
  await t
    .withIdentity(playerIdentity(1))
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });

  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.lifecycle.updateTournamentSetup, {
        tournamentId,
        entryFeeCents: 3000,
      }),
  ).rejects.toThrow("locked once a payment exists");

  // A terminal order locks it too: an expired session can still complete
  // late (async payments), so no order status is safe to reprice around.
  const order = await latestOrderFor(t, tournamentId, 1);
  await t.mutation(internal.payments.webhooks.handleCheckoutExpired, {
    stripeEventId: "evt_freeze_expired",
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
  });
  expect((await latestOrderFor(t, tournamentId, 1)).status).toBe("expired");
  await expect(
    t
      .withIdentity(organizerIdentity)
      .mutation(api.tournaments.lifecycle.updateTournamentSetup, {
        tournamentId,
        entryFeeCents: 3000,
      }),
  ).rejects.toThrow("locked once a payment exists");
});
