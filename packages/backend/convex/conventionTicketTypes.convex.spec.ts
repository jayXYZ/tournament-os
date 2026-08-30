/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  organizerIdentity,
  playerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The composable-ticketing rules (ADR 0004): sale windows with the
// admission-end default, per-type capacity, the ticket-type switch during a
// live checkout, comped child events, the day-scoped badge gate, and the
// delete guard.

const gatewayState = vi.hoisted(() => ({
  expired: [] as Array<string>,
  refunds: [] as Array<{ chargeId: string; amountCents: number }>,
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
    retrieveCheckoutSessionStatus: async () => "expired" as const,
    createRefund: async (args: { chargeId: string; amountCents: number }) => {
      gatewayState.refunds.push(args);
      return {
        stripeRefundId: `re_test_${gatewayState.refunds.length}`,
        status: "succeeded" as const,
      };
    },
    retrieveTransfersCapabilityStatus: async () => "active" as const,
    createTransfer: async () => ({ stripeTransferId: "tr_test" }),
  }),
}));

beforeEach(() => {
  gatewayState.expired = [];
  gatewayState.refunds = [];
  gatewayState.nextSessionNumber = 1;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 24 * 60 * 60 * 1000;

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

async function makePayoutsReady(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
) {
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
}

// Creates a ticket type as the organizer did before the convention started —
// new types are only mintable pre-start (ADR 0004), so the fixture winds the
// fake clock back to just before the start and returns it to the live "now"
// afterwards.
async function createTicketTypePreStart(
  t: TestConvex<typeof schema>,
  startDate: number,
  args: {
    conventionId: Id<"conventions">;
    name: string;
    priceCents: number;
    capacity?: number;
    admissionStartDate?: number;
    admissionEndDate?: number;
    saleStartDate?: number;
    saleEndDate?: number;
    includedTournamentIds?: Array<Id<"tournaments">>;
  },
): Promise<Id<"conventionTicketTypes">> {
  const organizer = t.withIdentity(organizerIdentity);
  const liveNow = Date.now();
  vi.setSystemTime(startDate - 60 * 60 * 1000);
  try {
    return await organizer.mutation(
      api.conventions.ticketTypes.createTicketType,
      args,
    );
  } finally {
    vi.setSystemTime(liveNow);
  }
}

// A convention already underway: started yesterday, ends the day after
// tomorrow — the door-sales shape the removed in_progress phase now allows.
async function seedLiveConvention(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const startDate = Date.now() - DAY;
  const endDate = Date.now() + 2 * DAY;
  const conventionId: Id<"conventions"> = await organizer.mutation(
    api.conventions.lifecycle.createConvention,
    {
      organizationId,
      name: "Live Gathering",
      startDate,
      endDate,
      playerCapacity: 50,
    },
  );
  await organizer.mutation(api.conventions.lifecycle.publishConvention, {
    conventionId,
  });
  const ticketTypes = await organizer.query(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId },
  );
  return {
    conventionId,
    startDate,
    endDate,
    defaultTicketTypeId: ticketTypes[0]!._id,
  };
}

test("sale windows: door sales stay open, a pass for a finished day is not purchasable, and the sale-end bound holds", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, startDate, defaultTicketTypeId } =
    await seedLiveConvention(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);

  // A day pass whose admitted day already ended: never buyable now — its
  // effective sale end defaulted to the admission end.
  const yesterdayPassId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Yesterday pass",
    priceCents: 0,
    admissionStartDate: startDate,
    admissionEndDate: Date.now() - 60_000,
  });
  // A pass whose sale has not started yet.
  const laterPassId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Late-drop pass",
    priceCents: 0,
    saleStartDate: Date.now() + DAY,
  });
  // An explicit sale end past the admission end is refused outright.
  await expect(
    createTicketTypePreStart(t, startDate, {
      conventionId,
      name: "Overlong sale",
      priceCents: 0,
      admissionStartDate: startDate,
      admissionEndDate: Date.now() + 60_000,
      saleEndDate: Date.now() + DAY,
    }),
  ).rejects.toThrow(/sales must end/i);

  // Minting a NEW type once the convention is underway is refused (ADR
  // 0004); editing existing ones stays open for the whole run.
  await expect(
    organizer.mutation(api.conventions.ticketTypes.createTicketType, {
      conventionId,
      name: "Door special",
      priceCents: 0,
    }),
  ).rejects.toThrow(/cannot be added once the convention has started/);

  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  await expect(
    player.mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId: yesterdayPassId,
    }),
  ).rejects.toThrow(/not on sale/);
  await expect(
    player.mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId: laterPassId,
    }),
  ).rejects.toThrow(/not on sale/);

  // The full-convention pass sells mid-con: no start transition closed it.
  await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId: defaultTicketTypeId },
  );

  const publicTypes = await t.query(
    api.conventions.ticketTypes.listPublicTicketTypes,
    { conventionId },
  );
  expect(
    Object.fromEntries(publicTypes.map((row) => [row.name, row.onSale])),
  ).toEqual({
    "General admission": true,
    "Yesterday pass": false,
    "Late-drop pass": false,
  });
});

test("per-type capacity: a full pass refuses registration and releases its seat on cancel", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, startDate } = await seedLiveConvention(
    t,
    organizationId,
  );
  const vipId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "VIP",
    priceCents: 0,
    capacity: 1,
  });
  await insertPlayerUser(t, 1);
  await insertPlayerUser(t, 2);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId: vipId,
    });
  await expect(
    t
      .withIdentity(playerIdentity(2))
      .mutation(api.conventions.registrations.registerSelfForConvention, {
        conventionId,
        ticketTypeId: vipId,
      }),
  ).rejects.toThrow(/VIP is sold out/);

  // Cancelling releases the per-type seat alongside the convention's.
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.conventions.registrations.cancelMyBadge, { conventionId });
  expect((await t.run(async (ctx) => ctx.db.get(vipId)))?.confirmedCount).toBe(
    0,
  );
  await t
    .withIdentity(playerIdentity(2))
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId: vipId,
    });
});

test("switching ticket types mid-checkout closes the old order and mints one for the new pass", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await makePayoutsReady(t, organizationId);
  const { conventionId, startDate } = await seedLiveConvention(
    t,
    organizationId,
  );
  const dayPassId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Day pass",
    priceCents: 1500,
  });
  const weekendPassId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Weekend pass",
    priceCents: 4000,
  });
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));

  await player.action(api.payments.checkout.createBadgeCheckout, {
    conventionId,
    ticketTypeId: dayPassId,
  });
  const badge = (await player.query(api.conventions.registrations.getMyBadge, {
    conventionId,
  }))!;
  expect(badge.ticketTypeId).toBe(dayPassId);

  await player.action(api.payments.checkout.createBadgeCheckout, {
    conventionId,
    ticketTypeId: weekendPassId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const orders = await t.run(async (ctx) =>
    ctx.db
      .query("paymentOrders")
      .withIndex("by_registrationId", (q) => q.eq("registrationId", badge._id))
      .take(8),
  );
  expect(orders).toHaveLength(2);
  const dayOrder = orders.find((order) => order.ticketTypeId === dayPassId)!;
  const weekendOrder = orders.find(
    (order) => order.ticketTypeId === weekendPassId,
  )!;
  // The old pass's order is closed (never repriced) and its session expired.
  expect(dayOrder.status).toBe("canceled");
  expect(gatewayState.expired).toContain(dayOrder.stripeCheckoutSessionId!);
  expect(weekendOrder.status).toBe("awaiting_payment");
  expect(weekendOrder.amountBreakdown.entryFeeCents).toBe(4000);
  expect(
    (await player.query(api.conventions.registrations.getMyBadge, {
      conventionId,
    }))!.ticketTypeId,
  ).toBe(weekendPassId);
});

test("a pass that comps a child event registers its holder free; other badges still pay", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await makePayoutsReady(t, organizationId);
  const { conventionId, startDate, defaultTicketTypeId } =
    await seedLiveConvention(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Paid Main Event",
      startDate: Date.now() + DAY,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2500,
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const vipId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "VIP",
    priceCents: 0,
    includedTournamentIds: [tournamentId],
  });

  // The VIP holder registers for the paid child event with no order.
  await insertPlayerUser(t, 1);
  const vip = t.withIdentity(playerIdentity(1));
  await vip.mutation(api.conventions.registrations.registerSelfForConvention, {
    conventionId,
    ticketTypeId: vipId,
  });
  const registrationId: Id<"tournamentRegistrations"> = await vip.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  const registration = await t.run(async (ctx) => ctx.db.get(registrationId));
  expect(registration?.entryStatus).toBe("confirmed");
  expect(
    await t.run(async (ctx) =>
      ctx.db
        .query("paymentOrders")
        .withIndex("by_registrationId", (q) =>
          q.eq("registrationId", registrationId),
        )
        .first(),
    ),
  ).toBeNull();

  // The free admission is audited as a comped entry (ADR 0004).
  const auditEvents = await t.run(async (ctx) =>
    ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .take(16),
  );
  expect(auditEvents.map((row) => row.event)).toContainEqual(
    expect.objectContaining({ type: "player_registered", compedByBadge: true }),
  );

  // The public page's flag routes the holder to free direct registration
  // instead of Checkout.
  const publicCode = String(
    (await t.run(async (ctx) => ctx.db.get(tournamentId)))!.publicCode,
  );
  expect(
    (await vip.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
    }))!.convention!.myBadgeCompsThisEvent,
  ).toBe(true);

  // A general-admission badge holder is not comped.
  await insertPlayerUser(t, 2);
  const general = t.withIdentity(playerIdentity(2));
  await general.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId: defaultTicketTypeId },
  );
  await expect(
    general.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow(/entry fee/);
  expect(
    (await general.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
    }))!.convention!.myBadgeCompsThisEvent,
  ).toBe(false);
});

test("approval and restore seat a comped participant free and audit the comp", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await makePayoutsReady(t, organizationId);
  const { conventionId, startDate } = await seedLiveConvention(
    t,
    organizationId,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Paid Invitational",
      startDate: Date.now() + DAY,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    entryFeeCents: 2500,
    registrationRequiresApproval: true,
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const vipId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "VIP",
    priceCents: 0,
    includedTournamentIds: [tournamentId],
  });

  await insertPlayerUser(t, 1);
  const vip = t.withIdentity(playerIdentity(1));
  await vip.mutation(api.conventions.registrations.registerSelfForConvention, {
    conventionId,
    ticketTypeId: vipId,
  });
  const registrationId: Id<"tournamentRegistrations"> = await vip.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );

  const noOrders = async () =>
    await t.run(async (ctx) =>
      ctx.db
        .query("paymentOrders")
        .withIndex("by_registrationId", (q) =>
          q.eq("registrationId", registrationId),
        )
        .first(),
    );
  const entryStatus = async () =>
    (await t.run(async (ctx) => ctx.db.get(registrationId)))?.entryStatus;

  // Approval seats the comped applicant directly — no payment request.
  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  expect(await entryStatus()).toBe("confirmed");
  expect(await noOrders()).toBeNull();

  // A cancel-then-reinstate reseats the comped entry free the same way.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId,
  });
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    {
      registrationId,
    },
  );
  expect(await entryStatus()).toBe("confirmed");
  expect(await noOrders()).toBeNull();

  const auditEvents = await t.run(async (ctx) =>
    ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .take(32),
  );
  expect(auditEvents.map((row) => row.event)).toContainEqual(
    expect.objectContaining({
      type: "registration_approved",
      compedByBadge: true,
    }),
  );
  expect(auditEvents.map((row) => row.event)).toContainEqual(
    expect.objectContaining({
      type: "player_reinstated",
      compedByBadge: true,
    }),
  );
});

test("a paid type stays editable when Stripe readiness regresses; a price change re-checks", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  await makePayoutsReady(t, organizationId);
  const { conventionId, startDate } = await seedLiveConvention(
    t,
    organizationId,
  );
  const paidId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Weekend pass",
    priceCents: 4000,
  });

  // Readiness regresses after the type went on sale.
  await t.run(async (ctx) => {
    const account = await ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId),
      )
      .first();
    await ctx.db.patch(account!._id, { payoutsReady: false });
  });

  const organizer = t.withIdentity(organizerIdentity);
  // Editing the frozen-price type — stopping its sale included — must still
  // work, or the organizer could not turn sales off.
  await organizer.mutation(api.conventions.ticketTypes.updateTicketType, {
    ticketTypeId: paidId,
    name: "Weekend pass",
    priceCents: 4000,
    saleEndDate: Date.now() - 60_000,
  });
  // Changing the price is a fresh decision to charge, so it re-checks.
  await expect(
    organizer.mutation(api.conventions.ticketTypes.updateTicketType, {
      ticketTypeId: paidId,
      name: "Weekend pass",
      priceCents: 5000,
    }),
  ).rejects.toThrow(/Stripe account/);
});

test("the badge gate requires the pass's admission window to cover the child event's date", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, startDate, endDate } = await seedLiveConvention(
    t,
    organizationId,
  );
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
    conventionId,
    badgeRequiredForChildEvents: true,
  });
  // A free event tomorrow; the day pass only admits today.
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Tomorrow Event",
      startDate: endDate - 60_000,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const todayPassId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Today pass",
    priceCents: 0,
    admissionStartDate: startDate,
    admissionEndDate: Date.now() + DAY / 2,
  });

  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId: todayPassId },
  );
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow(/does not cover/);
});

test("a ticket type with registrations cannot be deleted; an unused one can", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, startDate, defaultTicketTypeId } =
    await seedLiveConvention(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  await insertPlayerUser(t, 1);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId: defaultTicketTypeId,
    });

  await expect(
    organizer.mutation(api.conventions.ticketTypes.deleteTicketType, {
      ticketTypeId: defaultTicketTypeId,
    }),
  ).rejects.toThrow(/end its sale/);

  const unusedId = await createTicketTypePreStart(t, startDate, {
    conventionId,
    name: "Unused",
    priceCents: 0,
  });
  await organizer.mutation(api.conventions.ticketTypes.deleteTicketType, {
    ticketTypeId: unusedId,
  });
  expect(await t.run(async (ctx) => ctx.db.get(unusedId))).toBeNull();
});
