import { describe, expect, it } from "vitest";

import {
  badgeGateFor,
  deriveJoinAction,
  deriveRegistrationAction,
} from "./join-action.ts";
import type {
  JoinAction,
  JoinActionInput,
  RegistrationAction,
  RegistrationActionInput,
  SeatAction,
} from "./join-action.ts";
import type { PlayerTournamentEvent } from "./player-access.ts";

type Setup = "free" | "approval" | "paid" | "paidApproval";

const tournaments: Record<Setup, JoinActionInput["tournament"]> = {
  free: {
    lifecycle: "registration",
    entryFeeCents: undefined,
    registrationRequiresApproval: false,
  },
  approval: {
    lifecycle: "registration",
    entryFeeCents: undefined,
    registrationRequiresApproval: true,
  },
  paid: {
    lifecycle: "registration",
    entryFeeCents: 1500,
    registrationRequiresApproval: false,
  },
  paidApproval: {
    lifecycle: "registration",
    entryFeeCents: 1500,
    registrationRequiresApproval: true,
  },
};

type Scenario = Partial<Omit<JoinActionInput, "tournament">> & {
  lifecycle?: JoinActionInput["tournament"]["lifecycle"];
};

// A signed-in viewer with no row, an open event with room, and no badge in
// play; each scenario overrides only what it is about.
function derive(setup: Setup, scenario: Scenario = {}): JoinAction {
  const { lifecycle, ...rest } = scenario;
  return deriveJoinAction({
    tournament: {
      ...tournaments[setup],
      lifecycle: lifecycle ?? tournaments[setup].lifecycle,
    },
    signedIn: true,
    registration: null,
    order: null,
    badgeGate: null,
    badgeCompsThisEvent: false,
    spotsLeft: 10,
    ...rest,
  });
}

const row = (
  entryStatus: NonNullable<JoinActionInput["registration"]>["entryStatus"],
) => ({
  entryStatus,
});

// One row per state the join screen can land in, with the expected action
// for each event setup. Pinned against the web's RegistrationPanel branches.
const matrix: Array<[string, Scenario, Record<Setup, JoinAction>]> = [
  [
    "signed out while registration is open",
    { signedIn: false, registration: undefined, order: undefined },
    {
      free: { kind: "signIn" },
      approval: { kind: "signIn" },
      paid: { kind: "signIn" },
      paidApproval: { kind: "signIn" },
    },
  ],
  [
    "signed out after registration closed",
    { signedIn: false, lifecycle: "in_progress" },
    {
      free: { kind: "closed" },
      approval: { kind: "closed" },
      paid: { kind: "closed" },
      paidApproval: { kind: "closed" },
    },
  ],
  [
    "the registration row still loading",
    { registration: undefined },
    {
      free: { kind: "loading" },
      approval: { kind: "loading" },
      paid: { kind: "loading" },
      paidApproval: { kind: "loading" },
    },
  ],
  [
    "no registration row",
    {},
    {
      free: { kind: "register", comped: false },
      approval: { kind: "requestToRegister", comped: false },
      paid: { kind: "pay" },
      paidApproval: { kind: "requestToRegister", comped: false },
    },
  ],
  [
    "a cancelled row re-registers like a fresh one",
    { registration: row("cancelled") },
    {
      free: { kind: "register", comped: false },
      approval: { kind: "requestToRegister", comped: false },
      paid: { kind: "pay" },
      paidApproval: { kind: "requestToRegister", comped: false },
    },
  ],
  [
    "a confirmed seat",
    { registration: row("confirmed") },
    {
      free: { kind: "registered" },
      approval: { kind: "registered" },
      paid: { kind: "registered" },
      paidApproval: { kind: "registered" },
    },
  ],
  [
    "a confirmed seat after registration closed",
    { registration: row("confirmed"), lifecycle: "in_progress" },
    {
      free: { kind: "registered" },
      approval: { kind: "registered" },
      paid: { kind: "registered" },
      paidApproval: { kind: "registered" },
    },
  ],
  [
    "a pending row with no order",
    { registration: row("pending"), order: null },
    {
      free: { kind: "pendingReview", canWithdraw: true },
      approval: { kind: "pendingReview", canWithdraw: true },
      paid: { kind: "pendingReview", canWithdraw: true },
      paidApproval: { kind: "pendingReview", canWithdraw: true },
    },
  ],
  [
    "a pending row while the order loads",
    { registration: row("pending"), order: undefined },
    {
      // Free events never consult the order.
      free: { kind: "pendingReview", canWithdraw: true },
      approval: { kind: "pendingReview", canWithdraw: true },
      paid: { kind: "loading" },
      paidApproval: { kind: "loading" },
    },
  ],
  [
    "a pending row after registration closed",
    { registration: row("pending"), lifecycle: "in_progress" },
    {
      free: { kind: "pendingReview", canWithdraw: false },
      approval: { kind: "pendingReview", canWithdraw: false },
      paid: { kind: "pendingReview", canWithdraw: false },
      paidApproval: { kind: "pendingReview", canWithdraw: false },
    },
  ],
  [
    "a waitlisted row",
    { registration: row("waitlisted") },
    {
      free: { kind: "waitlisted", canWithdraw: true },
      approval: { kind: "waitlisted", canWithdraw: true },
      paid: { kind: "waitlisted", canWithdraw: true },
      paidApproval: { kind: "waitlisted", canWithdraw: true },
    },
  ],
  [
    "a waitlisted row after registration closed",
    { registration: row("waitlisted"), lifecycle: "in_progress" },
    {
      free: { kind: "waitlisted", canWithdraw: false },
      approval: { kind: "waitlisted", canWithdraw: false },
      paid: { kind: "waitlisted", canWithdraw: false },
      paidApproval: { kind: "waitlisted", canWithdraw: false },
    },
  ],
  [
    "a rejected row",
    { registration: row("rejected") },
    {
      free: { kind: "rejected" },
      approval: { kind: "rejected" },
      paid: { kind: "rejected" },
      paidApproval: { kind: "rejected" },
    },
  ],
  [
    "a rejected row on a full event",
    { registration: row("rejected"), spotsLeft: 0 },
    {
      free: { kind: "rejected" },
      approval: { kind: "rejected" },
      paid: { kind: "rejected" },
      paidApproval: { kind: "rejected" },
    },
  ],
  [
    // registerSelf refuses applications at capacity too.
    "a full event",
    { spotsLeft: 0 },
    {
      free: { kind: "full", canWithdraw: false },
      approval: { kind: "full", canWithdraw: false },
      paid: { kind: "full", canWithdraw: false },
      paidApproval: { kind: "full", canWithdraw: false },
    },
  ],
  [
    "registration closed",
    { lifecycle: "in_progress" },
    {
      free: { kind: "closed" },
      approval: { kind: "closed" },
      paid: { kind: "closed" },
      paidApproval: { kind: "closed" },
    },
  ],
  [
    "a completed event",
    { lifecycle: "completed" },
    {
      free: { kind: "closed" },
      approval: { kind: "closed" },
      paid: { kind: "closed" },
      paidApproval: { kind: "closed" },
    },
  ],
  [
    "a badge-gated event without a badge",
    { badgeGate: "missing" },
    {
      free: { kind: "badgeBlocked", reason: "missing", canWithdraw: false },
      approval: { kind: "badgeBlocked", reason: "missing", canWithdraw: false },
      paid: { kind: "badgeBlocked", reason: "missing", canWithdraw: false },
      paidApproval: {
        kind: "badgeBlocked",
        reason: "missing",
        canWithdraw: false,
      },
    },
  ],
  [
    "a badge-gated event with a wrong-day badge",
    { badgeGate: "wrong_day" },
    {
      free: { kind: "badgeBlocked", reason: "wrong_day", canWithdraw: false },
      approval: {
        kind: "badgeBlocked",
        reason: "wrong_day",
        canWithdraw: false,
      },
      paid: { kind: "badgeBlocked", reason: "wrong_day", canWithdraw: false },
      paidApproval: {
        kind: "badgeBlocked",
        reason: "wrong_day",
        canWithdraw: false,
      },
    },
  ],
  [
    // ADR 0004: a comped viewer is never sent to Checkout.
    "a convention badge that comps this event",
    { badgeCompsThisEvent: true },
    {
      // Nothing to comp on a free event.
      free: { kind: "register", comped: false },
      approval: { kind: "requestToRegister", comped: false },
      paid: { kind: "register", comped: true },
      paidApproval: { kind: "requestToRegister", comped: true },
    },
  ],
  [
    "a comped viewer on a full event",
    { badgeCompsThisEvent: true, spotsLeft: 0 },
    {
      free: { kind: "full", canWithdraw: false },
      approval: { kind: "full", canWithdraw: false },
      paid: { kind: "full", canWithdraw: false },
      paidApproval: { kind: "full", canWithdraw: false },
    },
  ],
];

describe("deriveJoinAction", () => {
  for (const [name, scenario, expected] of matrix) {
    describe(name, () => {
      for (const setup of Object.keys(expected) as Setup[]) {
        it(setup, () => {
          expect(derive(setup, scenario)).toEqual(expected[setup]);
        });
      }
    });
  }

  // A pending entry on a paid event: the order is what separates an
  // application under review from an entry that owes payment.
  describe("a pending entry on a paid event", () => {
    const paidSetups: Setup[] = ["paid", "paidApproval"];

    it.each(paidSetups)(
      "%s: an approved application with a payable order completes payment",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "requires_payment", purpose: "post_approval" },
          }),
        ).toEqual({ kind: "completePayment", purpose: "post_approval" });
      },
    );

    it.each(paidSetups)(
      "%s: an unfinished direct checkout completes payment",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "awaiting_payment", purpose: "registration" },
          }),
        ).toEqual({ kind: "completePayment", purpose: "registration" });
      },
    );

    it.each(paidSetups)(
      "%s: an order that can no longer be paid leaves the entry pending review",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "expired", purpose: "registration" },
          }),
        ).toEqual({ kind: "pendingReview", canWithdraw: true });
      },
    );

    // The badge can stop admitting the event after the entry exists (a
    // cancelled badge, a rescheduled event). The gate blocks payment, but
    // the entry is still the viewer's to withdraw, as on the web.
    it.each(paidSetups)(
      "%s: a payable order behind the badge gate is blocked but can be withdrawn",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "requires_payment", purpose: "post_approval" },
            badgeGate: "wrong_day",
          }),
        ).toEqual({
          kind: "badgeBlocked",
          reason: "wrong_day",
          canWithdraw: true,
        });
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "awaiting_payment", purpose: "registration" },
            badgeGate: "missing",
          }),
        ).toEqual({
          kind: "badgeBlocked",
          reason: "missing",
          canWithdraw: true,
        });
      },
    );

    // Checkout refuses to resume the player's own direct checkout on a full
    // event; the entry is still theirs to withdraw.
    it.each(paidSetups)(
      "%s: an unfinished direct checkout on a full event is full but can be withdrawn",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "awaiting_payment", purpose: "registration" },
            spotsLeft: 0,
          }),
        ).toEqual({ kind: "full", canWithdraw: true });
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "requires_payment", purpose: "post_approval" },
            spotsLeft: 0,
          }),
        ).toEqual({ kind: "completePayment", purpose: "post_approval" });
      },
    );

    it.each(paidSetups)(
      "%s: a payable order after registration closed has nothing left to do",
      (setup) => {
        expect(
          derive(setup, {
            registration: row("pending"),
            order: { status: "requires_payment", purpose: "post_approval" },
            lifecycle: "in_progress",
          }),
        ).toEqual({ kind: "closed" });
      },
    );
  });
});

describe("badgeGateFor", () => {
  const convention = (
    overrides: Partial<NonNullable<PlayerTournamentEvent["convention"]>>,
  ): PlayerTournamentEvent["convention"] => ({
    name: "Summer Con",
    publicCode: "SUMCON",
    badgeRequiredForChildEvents: true,
    myBadgeStatus: "confirmed",
    myBadgeCompsThisEvent: false,
    myBadgeCoversThisEvent: true,
    ...overrides,
  });

  it.each<
    [
      string,
      PlayerTournamentEvent["convention"],
      ReturnType<typeof badgeGateFor>,
    ]
  >([
    ["a standalone event", null, null],
    [
      "a convention that doesn't require badges",
      convention({ badgeRequiredForChildEvents: false, myBadgeStatus: null }),
      null,
    ],
    ["no badge", convention({ myBadgeStatus: null }), "missing"],
    ["a pending badge", convention({ myBadgeStatus: "pending" }), "missing"],
    [
      "a badge for another day",
      convention({ myBadgeCoversThisEvent: false }),
      "wrong_day",
    ],
    ["a badge that covers the event", convention({}), null],
  ])("%s", (_name, input, expected) => {
    expect(badgeGateFor(input)).toBe(expected);
  });
});

// The web RegistrationPanel's whole decision. deriveJoinAction above is its
// projection, so the rows here cover what the projection drops: the auth
// gate's unverified state, a confirmed seat's participation and next step,
// why a payable entry can't be paid, and the repeat-drop refund flag. The
// web's characterization rows (tournament-public-page.test.tsx) pin the
// rendering of each.
describe("deriveRegistrationAction", () => {
  type RegistrationScenario = Partial<
    Omit<RegistrationActionInput, "tournament">
  > & {
    lifecycle?: RegistrationActionInput["tournament"]["lifecycle"];
  };

  // A verified viewer with no row, an open event with room, no badge in
  // play, and no earlier refund; each scenario overrides only what it is
  // about.
  function deriveFull(
    setup: Setup,
    scenario: RegistrationScenario = {},
  ): RegistrationAction {
    const { lifecycle, ...rest } = scenario;
    return deriveRegistrationAction({
      tournament: {
        ...tournaments[setup],
        lifecycle: lifecycle ?? tournaments[setup].lifecycle,
      },
      viewer: "ready",
      registration: null,
      order: null,
      refundFlag: { repeatDropFeesKept: false },
      badgeGate: null,
      badgeCompsThisEvent: false,
      spotsLeft: 10,
      ...rest,
    });
  }

  const everySetup = (action: RegistrationAction) => ({
    free: action,
    approval: action,
    paid: action,
    paidApproval: action,
  });

  const registrationMatrix: Array<
    [string, RegistrationScenario, Record<Setup, RegistrationAction>]
  > = [
    [
      "the auth gate still settling",
      { viewer: "pending", registration: undefined, order: undefined },
      everySetup({ kind: "loading" }),
    ],
    [
      "the auth gate still settling after registration closed",
      { viewer: "pending", lifecycle: "completed" },
      everySetup({ kind: "loading" }),
    ],
    [
      "an unverified viewer",
      { viewer: "unverified", registration: undefined, order: undefined },
      everySetup({ kind: "unverified" }),
    ],
    [
      // Only a verified identity can show the viewer their registration.
      "an unverified viewer after registration closed",
      { viewer: "unverified", lifecycle: "in_progress" },
      everySetup({ kind: "unverified" }),
    ],
    [
      "signed out while registration is open",
      { viewer: "signedOut", registration: undefined, order: undefined },
      everySetup({ kind: "signIn" }),
    ],
    [
      "signed out on a full event",
      { viewer: "signedOut", spotsLeft: 0 },
      everySetup({ kind: "signIn" }),
    ],
    [
      "signed out on a badge-gated event",
      { viewer: "signedOut", badgeGate: "missing" },
      everySetup({ kind: "signIn" }),
    ],
    [
      "signed out after registration closed",
      { viewer: "signedOut", lifecycle: "in_progress" },
      everySetup({ kind: "closed" }),
    ],
    [
      "the registration row still loading",
      { registration: undefined },
      everySetup({ kind: "loading" }),
    ],
    [
      "no registration row",
      {},
      {
        free: { kind: "register", comped: false },
        approval: { kind: "requestToRegister", comped: false },
        paid: { kind: "pay", repeatDropFeesKept: false },
        paidApproval: { kind: "requestToRegister", comped: false },
      },
    ],
    [
      "a cancelled row re-registers like a fresh one",
      { registration: row("cancelled") },
      {
        free: { kind: "register", comped: false },
        approval: { kind: "requestToRegister", comped: false },
        paid: { kind: "pay", repeatDropFeesKept: false },
        paidApproval: { kind: "requestToRegister", comped: false },
      },
    ],
    [
      // Checkout warns before payment that a cancel would keep the fees.
      // Approval mode files a free application, so the warning waits for
      // the payment step.
      "an earlier full refund for this event",
      { refundFlag: { repeatDropFeesKept: true } },
      {
        free: { kind: "register", comped: false },
        approval: { kind: "requestToRegister", comped: false },
        paid: { kind: "pay", repeatDropFeesKept: true },
        paidApproval: { kind: "requestToRegister", comped: false },
      },
    ],
    [
      "the refund flag still loading",
      { refundFlag: undefined },
      {
        free: { kind: "register", comped: false },
        approval: { kind: "requestToRegister", comped: false },
        paid: { kind: "pay", repeatDropFeesKept: false },
        paidApproval: { kind: "requestToRegister", comped: false },
      },
    ],
    [
      "a convention badge that comps this event",
      { badgeCompsThisEvent: true, refundFlag: { repeatDropFeesKept: true } },
      {
        free: { kind: "register", comped: false },
        approval: { kind: "requestToRegister", comped: false },
        paid: { kind: "register", comped: true },
        paidApproval: { kind: "requestToRegister", comped: true },
      },
    ],
    [
      "a pending row with no order",
      { registration: row("pending"), order: null },
      everySetup({ kind: "pendingReview", canWithdraw: true }),
    ],
    [
      "a pending row while the order loads",
      { registration: row("pending"), order: undefined },
      {
        free: { kind: "pendingReview", canWithdraw: true },
        approval: { kind: "pendingReview", canWithdraw: true },
        paid: { kind: "loading" },
        paidApproval: { kind: "loading" },
      },
    ],
    [
      "a pending row after registration closed",
      { registration: row("pending"), lifecycle: "in_progress" },
      everySetup({ kind: "pendingReview", canWithdraw: false }),
    ],
    [
      "a waitlisted row",
      { registration: row("waitlisted") },
      everySetup({ kind: "waitlisted", canWithdraw: true }),
    ],
    [
      "a waitlisted row after registration closed",
      { registration: row("waitlisted"), lifecycle: "in_progress" },
      everySetup({ kind: "waitlisted", canWithdraw: false }),
    ],
    [
      // Only a pending entry ever owes payment.
      "a waitlisted row with a payable order",
      {
        registration: row("waitlisted"),
        order: { status: "requires_payment", purpose: "post_approval" },
      },
      everySetup({ kind: "waitlisted", canWithdraw: true }),
    ],
    [
      "a rejected row",
      { registration: row("rejected") },
      everySetup({ kind: "rejected" }),
    ],
    [
      "a full event",
      { spotsLeft: 0, badgeGate: "missing", badgeCompsThisEvent: true },
      everySetup({ kind: "full" }),
    ],
    [
      "registration closed",
      { lifecycle: "in_progress" },
      everySetup({ kind: "closed" }),
    ],
    [
      "a cancelled event",
      { lifecycle: "cancelled" },
      everySetup({ kind: "closed" }),
    ],
    [
      "a badge-gated event without a badge",
      { badgeGate: "missing" },
      everySetup({ kind: "badgeBlocked", reason: "missing" }),
    ],
    [
      "a badge-gated event with a wrong-day badge",
      { badgeGate: "wrong_day" },
      everySetup({ kind: "badgeBlocked", reason: "wrong_day" }),
    ],
  ];

  for (const [name, scenario, expected] of registrationMatrix) {
    describe(name, () => {
      for (const setup of Object.keys(expected) as Setup[]) {
        it(setup, () => {
          expect(deriveFull(setup, scenario)).toEqual(expected[setup]);
        });
      }
    });
  }

  // A confirmed seat by participation × lifecycle. Every setup derives the
  // same, so the free event stands in for them.
  describe("a confirmed seat", () => {
    const cancel: SeatAction = { kind: "cancel", cancelOutcome: null };
    const playerView: SeatAction = { kind: "openPlayerView" };
    const locked: SeatAction = { kind: "locked" };
    const participations = [
      "active",
      "dropped",
      "disqualified",
      "eliminated",
    ] as const;
    const nextByLifecycle: Record<
      (typeof participations)[number],
      Record<
        "registration" | "in_progress" | "completed" | "cancelled",
        SeatAction
      >
    > = {
      active: {
        registration: cancel,
        in_progress: playerView,
        completed: locked,
        cancelled: locked,
      },
      dropped: {
        registration: cancel,
        in_progress: playerView,
        completed: locked,
        cancelled: locked,
      },
      disqualified: {
        registration: cancel,
        in_progress: playerView,
        completed: locked,
        cancelled: locked,
      },
      // Elimination only happens in play, so there is no cancel offer.
      eliminated: {
        registration: locked,
        in_progress: playerView,
        completed: locked,
        cancelled: locked,
      },
    };

    for (const participation of participations) {
      for (const [lifecycle, next] of Object.entries(
        nextByLifecycle[participation],
      ) as Array<[RegistrationScenario["lifecycle"] & string, SeatAction]>) {
        it.each(Object.keys(tournaments) as Setup[])(
          `${participation} × ${lifecycle}: %s`,
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: {
                  entryStatus: "confirmed",
                  participationStatus: participation,
                },
                lifecycle,
              }),
            ).toEqual({ kind: "registered", participation, next });
          },
        );
      }
    }

    // The server reads a missing status as active (model/participation.ts).
    it("a missing participation status reads as active", () => {
      expect(deriveFull("free", { registration: row("confirmed") })).toEqual({
        kind: "registered",
        participation: "active",
        next: cancel,
      });
    });

    // A seat outranks every admission check: full, gated, or comped.
    it("holds on a full, badge-gated event", () => {
      expect(
        deriveFull("paid", {
          registration: row("confirmed"),
          spotsLeft: 0,
          badgeGate: "missing",
        }),
      ).toEqual({ kind: "registered", participation: "active", next: cancel });
    });

    it.each(["full_refund", "entry_only_refund", "no_refund", null] as const)(
      "carries the order's cancel outcome: %s",
      (cancelOutcome) => {
        expect(
          deriveFull("paid", {
            registration: {
              entryStatus: "confirmed",
              participationStatus: "dropped",
            },
            order: { status: "paid", purpose: "registration", cancelOutcome },
          }),
        ).toEqual({
          kind: "registered",
          participation: "dropped",
          next: { kind: "cancel", cancelOutcome },
        });
      },
    );

    // The cancel button doesn't wait for the order; its note just isn't
    // there yet.
    it("offers cancel while the order loads", () => {
      expect(
        deriveFull("paid", {
          registration: row("confirmed"),
          order: undefined,
        }),
      ).toEqual({ kind: "registered", participation: "active", next: cancel });
    });
  });

  // A pending entry on a paid event: why a payable one can't be paid.
  describe("a pending entry with a payable order", () => {
    const paidSetups: Setup[] = ["paid", "paidApproval"];
    const orders = [
      { status: "requires_payment", purpose: "post_approval" },
      { status: "awaiting_payment", purpose: "post_approval" },
      { status: "awaiting_payment", purpose: "registration" },
      { status: "requires_payment", purpose: "registration" },
    ] as const;

    for (const order of orders) {
      describe(`${order.status} (${order.purpose})`, () => {
        it.each(paidSetups)("%s: can be paid", (setup) => {
          expect(
            deriveFull(setup, { registration: row("pending"), order }),
          ).toEqual({
            kind: "completePayment",
            purpose: order.purpose,
            blocked: null,
          });
        });

        it.each(paidSetups)(
          "%s: registration closed before payment",
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                lifecycle: "in_progress",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "closed",
            });
          },
        );

        it.each(paidSetups)("%s: behind the badge gate", (setup) => {
          expect(
            deriveFull(setup, {
              registration: row("pending"),
              order,
              badgeGate: "wrong_day",
            }),
          ).toEqual({
            kind: "completePayment",
            purpose: order.purpose,
            blocked: "wrong_day",
          });
          expect(
            deriveFull(setup, {
              registration: row("pending"),
              order,
              badgeGate: "missing",
            }),
          ).toEqual({
            kind: "completePayment",
            purpose: order.purpose,
            blocked: "missing",
          });
        });

        // Closed outranks the gate: there is nothing left to do either way.
        it.each(paidSetups)(
          "%s: behind the badge gate after registration closed",
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                badgeGate: "missing",
                lifecycle: "completed",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "closed",
            });
          },
        );

        // Checkout re-checks capacity before resuming the player's own
        // direct checkout (payments/checkout.ts), but not before an
        // approved application's payment: the approval already checked it.
        it.each(paidSetups)("%s: on a full event", (setup) => {
          expect(
            deriveFull(setup, {
              registration: row("pending"),
              order,
              spotsLeft: 0,
            }),
          ).toEqual({
            kind: "completePayment",
            purpose: order.purpose,
            blocked: order.purpose === "registration" ? "full" : null,
          });
        });

        // Closed outranks full, and full outranks the badge gate: a badge
        // would not help on a full event.
        it.each(paidSetups)(
          "%s: on a full event behind the badge gate",
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                spotsLeft: 0,
                badgeGate: "missing",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: order.purpose === "registration" ? "full" : "missing",
            });
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                spotsLeft: 0,
                lifecycle: "in_progress",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "closed",
            });
          },
        );
      });
    }

    // A pass that started comping the event after the entry came to owe
    // payment: Checkout refuses a comped viewer, and registerSelf seats the
    // entry free and closes the order (model/roster.ts registerEntry).
    describe("once the viewer's badge comps the event", () => {
      for (const order of orders) {
        it.each(paidSetups)(
          `%s: ${order.status} (${order.purpose}) registers free`,
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                badgeCompsThisEvent: true,
              }),
            ).toEqual({ kind: "register", comped: true });
          },
        );

        // registerSelf checks capacity before seating the comped entry,
        // whatever the order's purpose.
        it.each(paidSetups)(
          `%s: ${order.status} (${order.purpose}) on a full event`,
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                badgeCompsThisEvent: true,
                spotsLeft: 0,
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "full",
            });
          },
        );

        it.each(paidSetups)(
          `%s: ${order.status} (${order.purpose}) after registration closed`,
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                badgeCompsThisEvent: true,
                lifecycle: "in_progress",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "closed",
            });
          },
        );

        // A pass that comps the event but not its day: the gate refuses
        // first (model/conventions.ts resolveChildEventAdmission).
        it.each(paidSetups)(
          `%s: ${order.status} (${order.purpose}) behind the badge gate`,
          (setup) => {
            expect(
              deriveFull(setup, {
                registration: row("pending"),
                order,
                badgeCompsThisEvent: true,
                badgeGate: "wrong_day",
              }),
            ).toEqual({
              kind: "completePayment",
              purpose: order.purpose,
              blocked: "wrong_day",
            });
          },
        );
      }

      // An application still under review has no order: the comp waits for
      // the organizer's decision, which seats it free (approveEntry).
      it.each(paidSetups)("%s: an application under review", (setup) => {
        expect(
          deriveFull(setup, {
            registration: row("pending"),
            order: null,
            badgeCompsThisEvent: true,
          }),
        ).toEqual({ kind: "pendingReview", canWithdraw: true });
      });
    });

    // The defensive fall-through (docs/plans/qr-join.md PR 3): the backend
    // sweep withdraws the pending entry behind every order it closes, so
    // this is no longer stored. A row the organizer is still reviewing
    // carries awaitingReview; this one wouldn't, and still reads as pending.
    it.each(
      paidSetups.flatMap((setup) =>
        (["expired", "canceled", "paid", "refunded"] as const).map(
          (status) => [setup, status] as const,
        ),
      ),
    )("%s: a %s order leaves the entry pending review", (setup, status) => {
      expect(
        deriveFull(setup, {
          registration: row("pending"),
          order: { status, purpose: "registration" },
        }),
      ).toEqual({ kind: "pendingReview", canWithdraw: true });
      expect(
        deriveFull(setup, {
          registration: row("pending"),
          order: { status, purpose: "registration" },
          lifecycle: "in_progress",
        }),
      ).toEqual({ kind: "pendingReview", canWithdraw: false });
    });
  });
});
