import { describe, expect, it } from "vitest";

import { badgeGateFor, deriveJoinAction } from "./join-action.ts";
import type { JoinAction, JoinActionInput } from "./join-action.ts";
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
      free: { kind: "full" },
      approval: { kind: "full" },
      paid: { kind: "full" },
      paidApproval: { kind: "full" },
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
      free: { kind: "full" },
      approval: { kind: "full" },
      paid: { kind: "full" },
      paidApproval: { kind: "full" },
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
