/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ORGANIZER_LIST_PAGE_SIZE } from "./model/pagination";
import { PAYMENT_FILTER_ROWS_PER_PAGE } from "./model/registrations";
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

// Rows for the row-budget test, written straight to the table as guest
// participants with no orders, so a thousand of them cost only the walk
// under test. The mirror is set by hand: the walks read the mirror, not the
// orders, and the first test pins that the order writes keep it in step.
async function seedMirroredRegistrations(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  rows: ReadonlyArray<{
    playerName: string;
    paymentStatus: Doc<"paymentOrders">["status"];
  }>,
) {
  await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const now = Date.now();
    for (const [index, row] of rows.entries()) {
      const participantId = await ctx.db.insert("participants", {
        displayName: row.playerName,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        participantId,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName: row.playerName,
        paymentStatus: row.paymentStatus,
        createdAt: now + index,
        tiebreakRandom: index,
        updatedAt: now,
      });
    }
  });
}

test("a payment-filtered page reads a bounded window; the search filters inside the index", async () => {
  const t = createConvexTest();
  const tournamentId = await seedPaidTournament(t);
  const asOwner = t.withIdentity(organizerIdentity);

  // The lone disputed row is the oldest, behind a full row budget of paid
  // rows, so the newest-first walk reads the whole budget before it.
  await seedMirroredRegistrations(t, tournamentId, [
    { playerName: "Player 0", paymentStatus: "disputed" },
    ...Array.from({ length: PAYMENT_FILTER_ROWS_PER_PAGE }, (_, i) => ({
      playerName: `Player ${i + 1}`,
      paymentStatus: "paid" as const,
    })),
  ]);
  const page = (
    payment: Array<Doc<"paymentOrders">["status"]> | undefined,
    cursor: string | null = null,
  ) =>
    asOwner.query(api.tournaments.registrations.listRegistrationPage, {
      tournamentId,
      ...(payment === undefined ? {} : { payment }),
      paginationOpts: { numItems: ORGANIZER_LIST_PAGE_SIZE, cursor },
    });

  // Without the chip a page reads exactly the rows it returns: no budget,
  // nothing to split.
  const plain = await page(undefined);
  expect(plain.page).toHaveLength(ORGANIZER_LIST_PAGE_SIZE);
  expect(plain.pageStatus ?? null).toBeNull();

  // Under it the first page stops at the budget — short, split required,
  // not done — instead of scanning on to the disputed row...
  const first = await page(["disputed"]);
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  expect(first.pageStatus).toBe("SplitRequired");
  expect(first.splitCursor).toEqual(expect.any(String));

  // ...which the next window, from its continueCursor, reaches.
  const next = await page(["disputed"], first.continueCursor);
  expect(names(next.page)).toEqual(["Player 0"]);
  expect(next.isDone).toBe(true);

  // A status dense enough to fill the page inside the budget settles.
  const paid = await page(["paid"]);
  expect(paid.page).toHaveLength(ORGANIZER_LIST_PAGE_SIZE);
  expect(paid.pageStatus ?? null).toBeNull();

  // The search narrows inside the index, so the lone status is found among
  // a thousand name matches, and a multi-status search gives each status a
  // share of its one page rather than letting the dense one fill it.
  // (convex-test ranks every matching row, so the index's 1024-row scan
  // window — what makes a post-filter miss — is not reproducible here; the
  // schema's filterFields are what tsc holds the search to.)
  const disputed = await asOwner.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Player", payment: ["disputed"] },
  );
  expect(names(disputed)).toEqual(["Player 0"]);
  const both = await asOwner.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Player", payment: ["paid", "disputed"] },
  );
  expect(both).toHaveLength(ORGANIZER_LIST_PAGE_SIZE);
  expect(names(both)).toContain("Player 0");
});
