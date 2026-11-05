import type { FunctionReturnType } from "convex/server";

import type { api } from "@paper-pairings/backend/convex/_generated/api";

import type { ViewerAuthGate } from "./auth-readiness";
import type {
  PlayerRegistration,
  PlayerTournamentEvent,
} from "./player-access";

// What an event's registration surface offers the viewer: the one primary
// action, or the status that stands in for it (docs/plans/qr-join.md PR 3).
// It is the single decision behind both clients. The web's
// RegistrationPanel (tournament-public-page.tsx) renders it whole; the
// native join screen renders its projection, JoinAction (deriveJoinAction
// below). Table tests pin both. Server mutations stay the authority: this
// only decides which button is worth showing.
export type RegistrationAction =
  // Something the decision depends on is still loading.
  | { kind: "loading" }
  // The provider has a user Convex could not verify (ViewerAuthGate). Only a
  // verified identity can show the viewer their registration, so this stands
  // in for every lifecycle.
  | { kind: "unverified" }
  | { kind: "signIn" }
  // registerSelf takes a seat. `comped`: a paid event the viewer's
  // convention badge covers (ADR 0004), so no payment is asked for. That
  // includes a pending entry owing payment the badge started comping since.
  | { kind: "register"; comped: boolean }
  // registerSelf files an application for the Review Queue.
  | { kind: "requestToRegister"; comped: boolean }
  // createEntryCheckout: a paid event with no approval step.
  // `repeatDropFeesKept`: the viewer already had a full refund for this
  // event, so cancelling again after paying refunds the entry cost only
  // (getMyRefundFlag). False while the flag loads.
  | { kind: "pay"; repeatDropFeesKept: boolean }
  // A pending entry with a payable order: an approved application
  // (`post_approval`) or the viewer's own unfinished checkout
  // (`registration`). Payment takes the seat. `blocked` says why the viewer
  // can't pay now, or null when they can (PaymentBlock). Once the viewer's
  // badge comps the event, the same entry reads as `register` instead.
  | {
      kind: "completePayment";
      purpose: EntryOrderPurpose;
      blocked: PaymentBlock;
    }
  // An application waiting on the organizer. `canWithdraw` while
  // registration is open (cancelMyRegistration).
  | { kind: "pendingReview"; canWithdraw: boolean }
  | { kind: "waitlisted"; canWithdraw: boolean }
  // A confirmed seat. `participation` is where the player stands since (a
  // missing status reads as active, as the server reads it); `next` is what
  // the seat allows now.
  | { kind: "registered"; participation: Participation; next: SeatAction }
  | { kind: "rejected" }
  | { kind: "full" }
  | { kind: "closed" }
  // A badge-gated convention child event the viewer's badge doesn't admit.
  | { kind: "badgeBlocked"; reason: Exclude<BadgeGate, null> };

// Why a pending entry's payable order can't be paid now, or null when it
// can. One reason is reported, in this order:
// - "closed": registration closed before they paid, so nothing is left to
//   do, withdrawal included.
// - "full": the event filled before they paid. Checkout re-checks capacity
//   before resuming the player's own direct checkout (payments/checkout.ts),
//   but not before an approved application's payment, which the approval
//   already checked. registerSelf checks it before seating an entry the
//   viewer's badge now comps, whatever the order. A badge would not help,
//   so this outranks the gate.
// - a badge gate reason: the badge stopped admitting the event after the
//   entry existed (a cancelled badge, a rescheduled event).
// The server still lets the viewer withdraw while registration is open.
export type PaymentBlock = "closed" | "full" | Exclude<BadgeGate, null> | null;

// What a confirmed seat allows next.
export type SeatAction =
  // Registration is open: releasing the seat is the one self-service change
  // (rejoining after a drop is an organizer reinstatement).
  // `cancelOutcome`: what cancelling does with a paid order's money
  // (getMyEntryOrder); null on a free event, while the order loads, or when
  // there is nothing to refund.
  | { kind: "cancel"; cancelOutcome: CancelOutcome }
  // The event is running. The player controller admits every confirmed
  // seat, whatever its participation, so it stays the way to live
  // standings and match history.
  | { kind: "openPlayerView" }
  // Registration changes are over: the event finished or was cancelled.
  // An eliminated seat outside play lands here too, since elimination only
  // happens in play.
  | { kind: "locked" };

// The one primary action the native join screen offers (docs/plans/qr-join.md
// PR 2a), or the status that stands in for it: RegistrationAction narrowed to
// what that screen needs. A pending entry it can't pay for reads as `full`
// or `badgeBlocked` (both still withdrawable) or `closed`; every confirmed
// seat reads as `registered`.
export type JoinAction =
  // Something the decision depends on is still loading.
  | { kind: "loading" }
  | { kind: "signIn" }
  // registerSelf takes a seat. `comped`: a paid event the viewer's
  // convention badge covers (ADR 0004), so no payment is asked for.
  | { kind: "register"; comped: boolean }
  // registerSelf files an application for the Review Queue.
  | { kind: "requestToRegister"; comped: boolean }
  // createEntryCheckout: a paid event with no approval step.
  | { kind: "pay" }
  // A pending entry with a payable order: an approved application
  // (`post_approval`) or the viewer's own unfinished checkout
  // (`registration`). Payment takes the seat.
  | { kind: "completePayment"; purpose: EntryOrderPurpose }
  // An application waiting on the organizer. `canWithdraw` while
  // registration is open (cancelMyRegistration).
  | { kind: "pendingReview"; canWithdraw: boolean }
  | { kind: "waitlisted"; canWithdraw: boolean }
  // A confirmed seat, whatever the player's participation since.
  | { kind: "registered" }
  | { kind: "rejected" }
  // `canWithdraw` when the viewer already holds a pending entry the full
  // event now stops them from paying for (PaymentBlock "full").
  | { kind: "full"; canWithdraw: boolean }
  | { kind: "closed" }
  // A badge-gated convention child event the viewer's badge doesn't admit.
  // `canWithdraw` when the viewer already holds a pending entry (an approved
  // application or unfinished checkout) that the gate now stops them from
  // paying for: a cancelled badge or a rescheduled event does this. The
  // server still lets them withdraw, so the screen keeps offering it.
  | {
      kind: "badgeBlocked";
      reason: Exclude<BadgeGate, null>;
      canWithdraw: boolean;
    };

type EntryOrder = NonNullable<
  FunctionReturnType<typeof api.payments.queries.getMyEntryOrder>
>;
type EntryOrderPurpose = EntryOrder["purpose"];
type CancelOutcome = EntryOrder["cancelOutcome"];
type Participation = NonNullable<PlayerRegistration["participationStatus"]>;

// Why a badge-gated child event refuses the viewer's self-serve entry
// (model/conventions.ts resolveChildEventAdmission): no confirmed badge, or
// a pass that does not admit the event's day. Null when nothing stands in
// the way. getPublicTournament computes it server-side, so it holds even
// when the viewer may not see the parent convention (and the page shows no
// convention summary).
export type BadgeGate = PlayerTournamentEvent["badgeGate"];

export type RegistrationActionInput = {
  tournament: Pick<
    PlayerTournamentEvent["tournament"],
    "lifecycle" | "entryFeeCents" | "registrationRequiresApproval"
  >;
  viewer: ViewerAuthGate;
  // The viewer's row from getMyRegistration: undefined while it loads,
  // null when there is none. Ignored unless the viewer is ready.
  registration:
    | Pick<PlayerRegistration, "entryStatus" | "participationStatus">
    | null
    | undefined;
  // getMyEntryOrder: undefined while it loads. Its status and purpose decide
  // a pending entry on a paid event; its cancel outcome only annotates a
  // confirmed seat's cancel, and reads as null when absent.
  order:
    | (Pick<EntryOrder, "status" | "purpose"> &
        Partial<Pick<EntryOrder, "cancelOutcome">>)
    | null
    | undefined;
  // getMyRefundFlag: undefined while it loads.
  refundFlag: { repeatDropFeesKept: boolean } | null | undefined;
  // getPublicTournament's badgeGate.
  badgeGate: BadgeGate;
  // getPublicTournament's convention.myBadgeCompsThisEvent, false when it
  // has no convention summary.
  badgeCompsThisEvent: boolean;
  spotsLeft: number;
};

export function deriveRegistrationAction(
  input: RegistrationActionInput,
): RegistrationAction {
  // Pending covers the provider loading and Convex validating the token:
  // never offer sign-in or a data-derived state before the gate settles.
  if (input.viewer === "pending") {
    return { kind: "loading" };
  }
  if (input.viewer === "unverified") {
    return { kind: "unverified" };
  }
  return deriveForViewer(input, input.viewer === "ready");
}

export type JoinActionInput = Omit<
  RegistrationActionInput,
  "viewer" | "registration" | "order" | "refundFlag"
> & {
  // The join screen is mounted behind the access ladder, which settles the
  // auth gate first, so only signed in or out reaches it.
  signedIn: boolean;
  // The viewer's row from getMyRegistration: undefined while it loads,
  // null when there is none. Ignored when signed out.
  registration: Pick<PlayerRegistration, "entryStatus"> | null | undefined;
  // getMyEntryOrder: undefined while it loads. Consulted only for a pending
  // entry on a paid event, the one case where it decides anything.
  order: Pick<EntryOrder, "status" | "purpose"> | null | undefined;
};

export function deriveJoinAction({
  signedIn,
  ...input
}: JoinActionInput): JoinAction {
  // The join screen shows neither a confirmed seat's cancel note nor the
  // repeat-drop warning, so the refund flag plays no part here.
  const action = deriveForViewer({ ...input, refundFlag: undefined }, signedIn);
  switch (action.kind) {
    case "registered":
      return { kind: "registered" };
    case "pay":
      return { kind: "pay" };
    case "completePayment":
      switch (action.blocked) {
        case null:
          return { kind: "completePayment", purpose: action.purpose };
        case "closed":
          return { kind: "closed" };
        case "full":
          return { kind: "full", canWithdraw: true };
        default:
          return {
            kind: "badgeBlocked",
            reason: action.blocked,
            canWithdraw: true,
          };
      }
    case "full":
      return { kind: "full", canWithdraw: false };
    case "badgeBlocked":
      return {
        kind: "badgeBlocked",
        reason: action.reason,
        canWithdraw: false,
      };
    default:
      return action;
  }
}

// The decision once the auth gate has settled signed in or out.
function deriveForViewer(
  {
    tournament,
    registration,
    order,
    refundFlag,
    badgeGate,
    badgeCompsThisEvent,
    spotsLeft,
  }: Omit<RegistrationActionInput, "viewer">,
  signedIn: boolean,
): Exclude<RegistrationAction, { kind: "unverified" }> {
  const open = tournament.lifecycle === "registration";
  const isPaid = (tournament.entryFeeCents ?? 0) > 0;

  if (!signedIn) {
    return open ? { kind: "signIn" } : { kind: "closed" };
  }
  if (registration === undefined) {
    return { kind: "loading" };
  }

  const entryStatus = registration?.entryStatus;
  switch (entryStatus) {
    case "confirmed": {
      const participation = registration?.participationStatus ?? "active";
      return {
        kind: "registered",
        participation,
        next:
          tournament.lifecycle === "in_progress"
            ? { kind: "openPlayerView" }
            : open && participation !== "eliminated"
              ? { kind: "cancel", cancelOutcome: order?.cancelOutcome ?? null }
              : { kind: "locked" },
      };
    }
    case "pending": {
      // Both an application under review and an approved entry that owes
      // payment are "pending"; only the order tells them apart. While it
      // loads, say nothing, so an approved player never sees "pending
      // approval" flash before "Complete payment".
      if (!isPaid) {
        return { kind: "pendingReview", canWithdraw: open };
      }
      if (order === undefined) {
        return { kind: "loading" };
      }
      if (
        order?.status === "requires_payment" ||
        order?.status === "awaiting_payment"
      ) {
        // A pass that started comping the event after the entry came to
        // owe payment: Checkout refuses a comped viewer, and registerSelf
        // seats the entry free and closes the order (model/roster.ts
        // registerEntry), checking capacity like any seat it takes.
        const comped = badgeCompsThisEvent;
        const blocked: PaymentBlock = !open
          ? "closed"
          : spotsLeft === 0 && (comped || order.purpose === "registration")
            ? "full"
            : badgeGate;
        if (comped && blocked === null) {
          return { kind: "register", comped: true };
        }
        return { kind: "completePayment", purpose: order.purpose, blocked };
      }
      // A defensive default: the backend sweep withdraws the pending entry
      // behind every order it closes (docs/plans/qr-join.md PR 3), so a
      // pending row on a paid event with an unpayable order is no longer
      // stored.
      return { kind: "pendingReview", canWithdraw: open };
    }
    case "waitlisted":
      return { kind: "waitlisted", canWithdraw: open };
    case "rejected":
      // An organizer decision; the way back is organizer approval.
      return { kind: "rejected" };
    case "cancelled":
    case undefined:
      // No live entry: a cancelled row re-registers like a fresh one.
      break;
    default:
      throw new Error(
        `Unhandled registration entry status: ${entryStatus satisfies never}`,
      );
  }

  if (!open) {
    return { kind: "closed" };
  }
  // registerSelf and the checkout both refuse a full event, applications
  // included (registrations.ts requireCapacityAvailable).
  if (spotsLeft === 0) {
    return { kind: "full" };
  }
  if (badgeGate !== null) {
    return { kind: "badgeBlocked", reason: badgeGate };
  }
  // A comped viewer never gets Checkout: the server refuses a comped
  // checkout and files the comp through registerSelf.
  const comped = isPaid && badgeCompsThisEvent;
  if (tournament.registrationRequiresApproval) {
    return { kind: "requestToRegister", comped };
  }
  if (isPaid && !comped) {
    return {
      kind: "pay",
      repeatDropFeesKept: refundFlag?.repeatDropFeesKept ?? false,
    };
  }
  return { kind: "register", comped };
}
