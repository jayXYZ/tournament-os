/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

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

// The roster's Payment filter and the mirror it reads
// (tournamentRegistrations.paymentStatus): every order write — checkout
// begin and attach, the completed/expired webhooks, a dispute, a cancel's
// refund — must leave the mirror equal to the registration's newest order,
// and both roster queries must narrow on it on the server, so a match the
// page or the search cap would have cut is still found. The Stripe gateway
// is mocked; every state change under test is a Convex mutation.

const gatewayState = vi.hoisted(() => ({
  nextSessionNumber: 1,
  refunds: 0,
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
    retrieveCheckoutSessionStatus: async () => "expired",
    createRefund: async () => ({
      stripeRefundId: `re_test_${++gatewayState.refunds}`,
      status: "succeeded" as const,
    }),
  }),
}));

beforeEach(() => {
  gatewayState.nextSessionNumber = 1;
  gatewayState.refunds = 0;
});

const START_DATE = Date.UTC(2027, 5, 12, 17, 0, 0);

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

async function seedPaidTournament(t: TestConvex<typeof schema>) {
  const { organizationId } = await seedOrganizer(t);
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
  });
  const tournamentId = await asOwner.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Paid Cup",
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
    registrationRequiresApproval: false,
  });
  await asOwner.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

// Every registration of the tournament with the mirror and the truth it
// mirrors (the newest order's status), so a test can assert the two agree
// after each transition without knowing which rows changed.
async function mirrorReport(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", tournamentId),
      )
      .take(64);
    const rows = [];
    for (const registration of registrations) {
      const [latest] = await ctx.db
        .query("paymentOrders")
        .withIndex("by_registrationId", (q) =>
          q.eq("registrationId", registration._id),
        )
        .order("desc")
        .take(1);
      rows.push({
        playerName: registration.playerName,
        mirror: registration.paymentStatus ?? null,
        newestOrder: latest?.status ?? null,
      });
    }
    rows.sort((a, b) => (a.playerName! < b.playerName! ? -1 : 1));
    return rows;
  });
}

async function expectMirrorInStep(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  expected: Record<number, Doc<"paymentOrders">["status"] | null>,
) {
  const report = await mirrorReport(t, tournamentId);
  for (const row of report) {
    expect(row.mirror, `${row.playerName} mirror`).toBe(row.newestOrder);
  }
  expect(
    Object.fromEntries(report.map((row) => [row.playerName, row.mirror])),
  ).toEqual(
    Object.fromEntries(
      Object.entries(expected).map(([n, status]) => [
        playerIdentity(Number(n)).name,
        status,
      ]),
    ),
  );
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
    const [order] = await ctx.db
      .query("paymentOrders")
      .withIndex("by_registrationId", (q) =>
        q.eq("registrationId", registration!._id),
      )
      .order("desc")
      .take(1);
    return order!;
  });
}

async function beginCheckout(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  playerN: number,
) {
  await insertPlayerUser(t, playerN);
  await t
    .withIdentity(playerIdentity(playerN))
    .action(api.payments.checkout.createEntryCheckout, { tournamentId });
  return await latestOrderFor(t, tournamentId, playerN);
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

const names = (rows: Array<{ playerName: string | undefined }>) =>
  rows.map((row) => row.playerName).sort();

test("every order write keeps the registration's payment mirror equal to its newest order", async () => {
  const t = createConvexTest();
  const tournamentId = await seedPaidTournament(t);

  // Begin: the order is minted requires_payment and attached as
  // awaiting_payment, both through the mirror.
  const one = await beginCheckout(t, tournamentId, 1);
  expect(one.status).toBe("awaiting_payment");
  await expectMirrorInStep(t, tournamentId, { 1: "awaiting_payment" });

  // The completed webhook pays it.
  await completePayment(t, one, "one");
  await expectMirrorInStep(t, tournamentId, { 1: "paid" });

  // An expired session closes a second player's order unpaid.
  const two = await beginCheckout(t, tournamentId, 2);
  await t.mutation(internal.payments.webhooks.handleCheckoutExpired, {
    stripeEventId: "evt_two_expired",
    orderId: two._id,
    sessionId: two.stripeCheckoutSessionId!,
  });
  await expectMirrorInStep(t, tournamentId, {
    1: "paid",
    2: "expired",
  });

  // A dispute on the first player's charge lands on their paid order.
  await t.mutation(internal.payments.webhooks.handleDisputeCreated, {
    stripeEventId: "evt_one_dispute",
    stripeChargeId: "ch_one",
  });
  await expectMirrorInStep(t, tournamentId, {
    1: "disputed",
    2: "expired",
  });

  // A third player pays, then cancels inside the refund window: the refund
  // executes and the order ends refunded.
  const three = await beginCheckout(t, tournamentId, 3);
  await completePayment(t, three, "three");
  await expectMirrorInStep(t, tournamentId, {
    1: "disputed",
    2: "expired",
    3: "paid",
  });
  await t
    .withIdentity(playerIdentity(3))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });
  const [refund] = await t.run(
    async (ctx) =>
      await ctx.db
        .query("paymentRefunds")
        .withIndex("by_orderId", (q) => q.eq("orderId", three._id))
        .take(1),
  );
  await t.action(internal.payments.refunds.executeRefund, {
    refundId: refund!._id,
  });
  await expectMirrorInStep(t, tournamentId, {
    1: "disputed",
    2: "expired",
    3: "refunded",
  });

  // The roster reads the mirror, not the orders.
  const asOwner = t.withIdentity(organizerIdentity);
  const history = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 100, cursor: null } },
  );
  expect(
    Object.fromEntries(
      history.page.map((row) => [row.playerName, row.paymentStatus]),
    ),
  ).toEqual({
    "Player 1": "disputed",
    "Player 2": "expired",
    "Player 3": "refunded",
  });
});

test("the payment filter narrows the list and the search on the server, past the page", async () => {
  const t = createConvexTest();
  const tournamentId = await seedPaidTournament(t);
  const asOwner = t.withIdentity(organizerIdentity);

  // Oldest to newest: 1 disputed, 2 paid, 3 paid, 4 unpaid (expired). The
  // list walks newest-first, so with a one-row page the disputed row is the
  // last row an unfiltered walk would reach.
  const one = await beginCheckout(t, tournamentId, 1);
  await completePayment(t, one, "one");
  await t.mutation(internal.payments.webhooks.handleDisputeCreated, {
    stripeEventId: "evt_one_dispute",
    stripeChargeId: "ch_one",
  });
  for (const n of [2, 3]) {
    const order = await beginCheckout(t, tournamentId, n);
    await completePayment(t, order, `p${n}`);
  }
  const four = await beginCheckout(t, tournamentId, 4);
  await t.mutation(internal.payments.webhooks.handleCheckoutExpired, {
    stripeEventId: "evt_four_expired",
    orderId: four._id,
    sessionId: four.stripeCheckoutSessionId!,
  });

  const unfiltered = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 1, cursor: null } },
  );
  expect(names(unfiltered.page)).toEqual(["Player 4"]);

  // The disputed row is found even though it sits three pages deep.
  const disputed = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      payment: ["disputed"],
      paginationOpts: { numItems: 1, cursor: null },
    },
  );
  expect(names(disputed.page)).toEqual(["Player 1"]);
  if (!disputed.isDone) {
    const rest = await asOwner.query(
      api.tournaments.registrations.listRegistrationPage,
      {
        tournamentId,
        payment: ["disputed"],
        paginationOpts: { numItems: 1, cursor: disputed.continueCursor },
      },
    );
    expect(rest.page).toEqual([]);
    expect(rest.isDone).toBe(true);
  }

  // A merged chip label ("Unpaid") arrives as every status it covers.
  const unpaid = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      payment: ["expired", "canceled"],
      paginationOpts: { numItems: 100, cursor: null },
    },
  );
  expect(names(unpaid.page)).toEqual(["Player 4"]);

  // The payment filter composes with the status filter...
  const paidCancelled = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      filter: "cancelled",
      payment: ["paid"],
      paginationOpts: { numItems: 100, cursor: null },
    },
  );
  expect(paidCancelled.page).toEqual([]);
  const paidConfirmed = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      filter: "confirmed",
      payment: ["paid"],
      paginationOpts: { numItems: 100, cursor: null },
    },
  );
  expect(names(paidConfirmed.page)).toEqual(["Player 2", "Player 3"]);

  // ...and with the search, where it runs before the take.
  const searched = await asOwner.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Player", payment: ["disputed", "paid"] },
  );
  expect(names(searched)).toEqual(["Player 1", "Player 2", "Player 3"]);
  const searchedUnpaid = await asOwner.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Player", payment: ["expired"] },
  );
  expect(names(searchedUnpaid)).toEqual(["Player 4"]);

  // An empty list is no filter at all.
  const everyone = await asOwner.query(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
      payment: [],
      paginationOpts: { numItems: 100, cursor: null },
    },
  );
  expect(everyone.page).toHaveLength(4);
});
