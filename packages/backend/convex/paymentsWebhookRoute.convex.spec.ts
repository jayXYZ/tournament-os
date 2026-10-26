/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The signed Stripe snapshot route (http.ts, /stripe/events) driven end to
// end for the refund lifecycle: a delivery is refused before any handler
// runs unless its signature verifies, and each refund event Stripe sends
// (refund.created, refund.updated, refund.failed) reaches the
// reconciliation handler and is recorded under its own type. The handler's
// rules are pinned in paymentsRefunds.convex.spec.ts; this suite goes
// through the route, so an event type the switch does not name fails here
// rather than in production. refund.created gets the most room: a refund
// that succeeds on creation is the one case Stripe sends no later update
// for, so it alone recovers a lost executor write for such a refund.
//
// Signature verification is mocked at the gateway (one fixed header
// passes; the payload is the event). Fake timers throughout: the cancel
// that queues a refund also schedules its executor and guard, and each
// test decides whether those run.

const gatewayState = vi.hoisted(() => ({
  webhookSecret: "whsec_test",
  validSignature: "t=1,v1=valid",
  nextSessionNumber: 1,
  // How many refund create calls reached the gateway.
  creates: 0,
  // When set, the executor cannot build its gateway: the execution dies
  // before any Stripe call, with nothing recorded, and its guard parks the
  // row. Stands in for a write lost after the request reached Stripe.
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
    requireStripeWebhookSecret: () => gatewayState.webhookSecret,
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
    createRefund: async () => {
      gatewayState.creates += 1;
      return {
        stripeRefundId: `re_executor_${gatewayState.creates}`,
        status: "succeeded" as const,
      };
    },
    findRefundForRow: async () => null,
    // Stands in for stripe-node's signature check: the fixed header against
    // the route's secret passes, anything else is the SDK's signature error.
    constructWebhookEvent: async (args: {
      payload: string;
      signature: string;
      secret: string;
    }) => {
      if (
        args.signature !== gatewayState.validSignature ||
        args.secret !== gatewayState.webhookSecret
      ) {
        throw new Error(
          "No signatures found matching the expected signature for payload",
        );
      }
      return JSON.parse(args.payload);
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  gatewayState.nextSessionNumber = 1;
  gatewayState.creates = 0;
  gatewayState.secretKeyError = null;
});

afterEach(() => {
  vi.useRealTimers();
});

const START_DATE = Date.UTC(2027, 5, 12, 17, 0, 0);
// What a first pre-deadline cancel of the 2000¢ entry refunds: entry plus
// the player's fee share, the row's amountCents.
const FULL_REFUND_CENTS = 2194;

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
      name: "Webhook Cup",
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
    refundDeadline: null,
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

// Pays for the player's entry on charge ch_one (the checkout action needs
// the gateway, so a test that breaks the executor's gateway does so after
// this). Returns the paid order's id.
async function payForEntry(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  await t
    .withIdentity(playerOne)
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  const order = await latestOrder(t, tournamentId);
  await t.mutation(internal.payments.webhooks.handleCheckoutCompleted, {
    stripeEventId: "evt_checkout_one",
    orderId: order._id,
    sessionId: order.stripeCheckoutSessionId!,
    stripePaymentIntentId: "pi_one",
    stripeChargeId: "ch_one",
  });
  return order._id;
}

// Cancels the paid entry, which queues the refund row under test (and
// schedules its executor, which never runs unless a test advances the
// clock). Returns the row as queued.
async function cancelPaidEntry(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  orderId: Id<"paymentOrders">,
) {
  await t
    .withIdentity(playerOne)
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  const refund = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", orderId))
        .unique(),
  );
  expect(refund).toMatchObject({ status: "pending" });
  expect(refund!.stripeRefundId).toBeUndefined();
  return refund!;
}

async function queuePaidEntryRefund(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await cancelPaidEntry(
    t,
    tournamentId,
    await payForEntry(t, tournamentId),
  );
}

async function refundRow(
  t: TestConvex<typeof schema>,
  refundId: Id<"paymentRefunds">,
) {
  return (await t.run(async (ctx) => await ctx.db.get(refundId)))!;
}

// The processed-event record's type for an event id, or null when the
// route never handed the event to a handler. Reads with unique(), so a
// double record for one delivery fails the test outright.
async function processedEventType(
  t: TestConvex<typeof schema>,
  stripeEventId: string,
) {
  return await t.run(async (ctx) => {
    const row = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", stripeEventId),
      )
      .unique();
    return row?.type ?? null;
  });
}

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

async function processingRefundsOnCard(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.payments.refunds.listRefundsNeedingAttention, {
      tournamentId,
      status: "pending",
      paginationOpts: { numItems: 8, cursor: null },
    });
  return page.page.map((row) => row.refundId);
}

type RefundEventType = "refund.created" | "refund.updated" | "refund.failed";

// A Stripe refund event as the route reads it (event.data.object is the
// refund), reduced to the fields the handler is given.
function refundEvent(args: {
  id: string;
  type: RefundEventType;
  refund: {
    id: string;
    charge: string;
    status: "pending" | "succeeded" | "failed";
    amount: number;
    // The row id stamped into metadata.refundId; null for a refund issued
    // outside the app.
    refundRowId: string | null;
    failureReason?: string;
  };
}) {
  return {
    id: args.id,
    object: "event",
    type: args.type,
    data: {
      object: {
        id: args.refund.id,
        object: "refund",
        charge: args.refund.charge,
        status: args.refund.status,
        amount: args.refund.amount,
        currency: "usd",
        metadata:
          args.refund.refundRowId === null
            ? {}
            : { refundId: args.refund.refundRowId },
        failure_reason: args.refund.failureReason ?? null,
      },
    },
  };
}

async function deliver(
  t: TestConvex<typeof schema>,
  event: unknown,
  signature: string | null = gatewayState.validSignature,
) {
  return await t.fetch("/stripe/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "stripe-signature": signature }),
    },
    body: JSON.stringify(event),
  });
}

test("a delivery without a verified signature is refused before any handler runs", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const refund = await queuePaidEntryRefund(t, tournamentId);
  const event = refundEvent({
    id: "evt_created_succeeded",
    type: "refund.created",
    refund: {
      id: "re_created_1",
      charge: "ch_one",
      status: "succeeded",
      amount: FULL_REFUND_CENTS,
      refundRowId: refund._id,
    },
  });

  const unsigned = await deliver(t, event, null);
  expect(unsigned.status).toBe(400);
  expect(await unsigned.text()).toBe("Missing signature");
  const forged = await deliver(t, event, "t=1,v1=forged");
  expect(forged.status).toBe(400);
  expect(await forged.text()).toBe("Invalid signature");
  expect(await processedEventType(t, "evt_created_succeeded")).toBeNull();
  expect(await refundRow(t, refund._id)).toMatchObject({ status: "pending" });
  expect((await latestOrder(t, tournamentId)).status).toBe("paid");

  // The same event, signed: the executor's write for a refund that
  // succeeded on creation was lost, and refund.created is the one report
  // Stripe sends for it.
  const signed = await deliver(t, event);
  expect(signed.status).toBe(200);
  expect(await processedEventType(t, "evt_created_succeeded")).toBe(
    "refund.created",
  );
  expect(await refundRow(t, refund._id)).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_created_1",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("a refund that succeeded on creation settles the row its guard parked, through refund.created alone", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const orderId = await payForEntry(t, tournamentId);
    // The execution dies without recording anything; its guard parks the
    // row (paymentsRefunds.convex.spec.ts pins that path).
    gatewayState.secretKeyError = new Error("STRIPE_SECRET_KEY is not set");
    const refund = await cancelPaidEntry(t, tournamentId, orderId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "needs_attention",
    });
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });

    // Parking is final for automation: with the fault cleared, nothing
    // runs. (The route builds the same gateway, so the fault has to clear
    // before a delivery can be verified.)
    gatewayState.secretKeyError = null;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(0);

    // Stripe's side of the story: the request landed and the card refund
    // succeeded at once, stamped with the row. Its status will never
    // change, so no refund.updated follows; before the route named
    // refund.created, this row stayed parked until an owner clicked
    // Check refund status.
    const response = await deliver(
      t,
      refundEvent({
        id: "evt_created_after_crash",
        type: "refund.created",
        refund: {
          id: "re_after_crash",
          charge: "ch_one",
          status: "succeeded",
          amount: FULL_REFUND_CENTS,
          refundRowId: refund._id,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await processedEventType(t, "evt_created_after_crash")).toBe(
      "refund.created",
    );
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_after_crash",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    expect(await processingRefundsOnCard(t, tournamentId)).toEqual([]);

    // Nothing automatic sends anything afterwards either: the settled row
    // is not revisited.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(gatewayState.creates).toBe(0);
    expect(await refundAuditCounts(t, tournamentId)).toEqual({
      refund_stalled: 1,
      refund_failed: 0,
    });
  } finally {
    consoleError.mockRestore();
  }
});

test.each([
  { arrival: "in order", createdFirst: true },
  { arrival: "with the created report late", createdFirst: false },
])(
  "a processing refund's created report binds the row and the lifecycle settles the same way when the events arrive $arrival",
  async ({ createdFirst }) => {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const refund = await queuePaidEntryRefund(t, tournamentId);
    const created = refundEvent({
      id: "evt_created_processing",
      type: "refund.created",
      refund: {
        id: "re_bank",
        charge: "ch_one",
        status: "pending",
        amount: FULL_REFUND_CENTS,
        refundRowId: refund._id,
      },
    });
    const updated = refundEvent({
      id: "evt_updated_succeeded",
      type: "refund.updated",
      refund: {
        id: "re_bank",
        charge: "ch_one",
        status: "succeeded",
        amount: FULL_REFUND_CENTS,
        refundRowId: refund._id,
      },
    });

    if (createdFirst) {
      // A bank-rail refund: created still processing. The row records the
      // Stripe id and stays pending, listed on the payout card as
      // processing, until the update settles it.
      expect((await deliver(t, created)).status).toBe(200);
      expect(await refundRow(t, refund._id)).toMatchObject({
        status: "pending",
        stripeRefundId: "re_bank",
      });
      expect(await processingRefundsOnCard(t, tournamentId)).toEqual([
        refund._id,
      ]);
      expect((await latestOrder(t, tournamentId)).status).toBe("paid");
      expect((await deliver(t, updated)).status).toBe(200);
    } else {
      // Stripe does not order deliveries: the success lands first and the
      // created report of a refund still processing comes after. It must
      // not pull the settled row back to pending.
      expect((await deliver(t, updated)).status).toBe(200);
      expect(await refundRow(t, refund._id)).toMatchObject({
        status: "succeeded",
        stripeRefundId: "re_bank",
      });
      expect((await deliver(t, created)).status).toBe(200);
    }

    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_bank",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
    expect(await processingRefundsOnCard(t, tournamentId)).toEqual([]);
    expect(await processedEventType(t, "evt_created_processing")).toBe(
      "refund.created",
    );
    expect(await processedEventType(t, "evt_updated_succeeded")).toBe(
      "refund.updated",
    );
  },
);

test("a redelivered refund.created is recorded once and re-evaluates nothing", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const refund = await queuePaidEntryRefund(t, tournamentId);
  const created = refundEvent({
    id: "evt_created_once",
    type: "refund.created",
    refund: {
      id: "re_redelivered",
      charge: "ch_one",
      status: "pending",
      amount: FULL_REFUND_CENTS,
      refundRowId: refund._id,
    },
  });

  expect((await deliver(t, created)).status).toBe(200);
  expect(await refundRow(t, refund._id)).toMatchObject({
    status: "pending",
    stripeRefundId: "re_redelivered",
  });

  // A marker the handler would erase if it ran the report again
  // (recordRefundInFlight clears lastError): the redelivery is a no-op by
  // event id, not merely harmless by status.
  await t.run(async (ctx) => {
    await ctx.db.patch(refund._id, { lastError: "left by the test" });
  });
  expect((await deliver(t, created)).status).toBe(200);
  expect(await refundRow(t, refund._id)).toMatchObject({
    status: "pending",
    stripeRefundId: "re_redelivered",
    lastError: "left by the test",
  });
  expect(await processedEventType(t, "evt_created_once")).toBe(
    "refund.created",
  );

  // Settled, then the created report comes round a third time.
  expect(
    (
      await deliver(
        t,
        refundEvent({
          id: "evt_updated_once",
          type: "refund.updated",
          refund: {
            id: "re_redelivered",
            charge: "ch_one",
            status: "succeeded",
            amount: FULL_REFUND_CENTS,
            refundRowId: refund._id,
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect((await deliver(t, created)).status).toBe(200);
  expect(await refundRow(t, refund._id)).toMatchObject({
    status: "succeeded",
    stripeRefundId: "re_redelivered",
  });
  expect((await latestOrder(t, tournamentId)).status).toBe("refunded");
});

test("refund.created is held to the handler's charge, amount and identity guards", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const refund = await queuePaidEntryRefund(t, tournamentId);
    // A partial refund, so that a second refund for the row's amount fits
    // under the charge and Stripe would accept it.
    await t.run(async (ctx) => {
      await ctx.db.patch(refund._id, { amountCents: 1000 });
    });
    const created = (
      id: string,
      stripeRefundId: string,
      status: "pending" | "succeeded",
      overrides?: { charge?: string; amount?: number; refundRowId?: null },
    ) =>
      refundEvent({
        id,
        type: "refund.created",
        refund: {
          id: stripeRefundId,
          charge: overrides?.charge ?? "ch_one",
          status,
          amount: overrides?.amount ?? 1000,
          refundRowId:
            overrides?.refundRowId === null ? null : (refund._id as string),
        },
      });
    const untouched = async () => {
      expect(await refundRow(t, refund._id)).toMatchObject({
        status: "pending",
        amountCents: 1000,
      });
      expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    };

    // Stamped with the row but on another charge: not the row's money.
    expect(
      (
        await deliver(
          t,
          created("evt_wrong_charge", "re_wrong_charge", "succeeded", {
            charge: "ch_other",
          }),
        )
      ).status,
    ).toBe(200);
    await untouched();
    expect((await refundRow(t, refund._id)).stripeRefundId).toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);

    // The row's charge and stamp, another amount.
    expect(
      (
        await deliver(
          t,
          created("evt_wrong_amount", "re_wrong_amount", "succeeded", {
            amount: FULL_REFUND_CENTS,
          }),
        )
      ).status,
    ).toBe(200);
    await untouched();
    expect((await refundRow(t, refund._id)).stripeRefundId).toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(2);

    // The row's own refund binds it; a second refund stamped with the row
    // then passes every other guard and is still refused, succeeded or
    // not.
    expect(
      (await deliver(t, created("evt_original", "re_original", "pending")))
        .status,
    ).toBe(200);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });
    expect(
      (await deliver(t, created("evt_second", "re_second", "succeeded")))
        .status,
    ).toBe(200);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe("paid");
    expect(consoleError).toHaveBeenCalledTimes(3);

    // A refund issued from the Stripe dashboard carries no stamp and no
    // known id: no row to settle, nothing to complain about.
    expect(
      (
        await deliver(
          t,
          created("evt_dashboard", "re_dashboard", "succeeded", {
            amount: 500,
            refundRowId: null,
          }),
        )
      ).status,
    ).toBe(200);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "pending",
      stripeRefundId: "re_original",
    });
    expect(consoleError).toHaveBeenCalledTimes(3);

    // Every refused report was still a processed delivery, under its type.
    for (const id of [
      "evt_wrong_charge",
      "evt_wrong_amount",
      "evt_original",
      "evt_second",
      "evt_dashboard",
    ]) {
      expect(await processedEventType(t, id)).toBe("refund.created");
    }

    // The row's own refund settles it, and the order reflects the partial
    // amount.
    expect(
      (
        await deliver(
          t,
          refundEvent({
            id: "evt_original_succeeded",
            type: "refund.updated",
            refund: {
              id: "re_original",
              charge: "ch_one",
              status: "succeeded",
              amount: 1000,
              refundRowId: refund._id,
            },
          }),
        )
      ).status,
    ).toBe(200);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: "succeeded",
      stripeRefundId: "re_original",
    });
    expect((await latestOrder(t, tournamentId)).status).toBe(
      "partially_refunded",
    );
  } finally {
    consoleError.mockRestore();
  }
});

test.each([
  {
    type: "refund.created" as const,
    status: "succeeded" as const,
    settled: { status: "succeeded", order: "refunded" },
  },
  {
    type: "refund.updated" as const,
    status: "succeeded" as const,
    settled: { status: "succeeded", order: "refunded" },
  },
  {
    type: "refund.failed" as const,
    status: "failed" as const,
    settled: { status: "failed", order: "paid" },
  },
])(
  "$type reaches the reconciliation handler and is recorded as itself",
  async ({ type, status, settled }) => {
    const t = createConvexTest();
    const { organizationId } = await seedOrganizer(t);
    const tournamentId = await seedPaidTournament(t, organizationId);
    const refund = await queuePaidEntryRefund(t, tournamentId);

    const response = await deliver(
      t,
      refundEvent({
        id: `evt_${type}`,
        type,
        refund: {
          id: "re_lifecycle",
          charge: "ch_one",
          status,
          amount: FULL_REFUND_CENTS,
          refundRowId: refund._id,
          failureReason:
            status === "failed" ? "expired_or_canceled_card" : undefined,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await processedEventType(t, `evt_${type}`)).toBe(type);
    expect(await refundRow(t, refund._id)).toMatchObject({
      status: settled.status,
      stripeRefundId: "re_lifecycle",
      ...(status === "failed" ? { lastError: "expired_or_canceled_card" } : {}),
    });
    expect((await latestOrder(t, tournamentId)).status).toBe(settled.order);
  },
);

test("an event type the route does not name is acknowledged and leaves no record", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await seedPaidTournament(t, organizationId);
  const refund = await queuePaidEntryRefund(t, tournamentId);

  // charge.refunded carries the charge, not the refund; Stripe's own
  // guidance is to listen to refund.created for the refund.
  const response = await deliver(t, {
    id: "evt_charge_refunded",
    object: "event",
    type: "charge.refunded",
    data: { object: { id: "ch_one", object: "charge", refunded: true } },
  });
  expect(response.status).toBe(200);
  expect(await processedEventType(t, "evt_charge_refunded")).toBeNull();
  expect(await refundRow(t, refund._id)).toMatchObject({ status: "pending" });
});
