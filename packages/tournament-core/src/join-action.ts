import type { FunctionReturnType } from "convex/server";

import type { api } from "@paper-pairings/backend/convex/_generated/api";

import type {
  PlayerRegistration,
  PlayerTournamentEvent,
} from "./player-access";

// The one primary action a join screen offers (docs/plans/qr-join.md), or
// the status that stands in for it. Every case mirrors a branch of the web's
// RegistrationPanel (tournament-public-page.tsx), which PR 3 moves onto this
// derivation; until then the two must agree, and the table tests pin this
// side. Server mutations stay the authority: this only decides which button
// is worth showing.
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
  | { kind: "full" }
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

type ConventionSummary = PlayerTournamentEvent["convention"];

// Why a badge-gated child event refuses the viewer's self-serve entry
// (model/conventions.ts resolveChildEventAdmission): no confirmed badge, or
// a pass that does not admit the event's day. Null when nothing stands in
// the way.
export type BadgeGate = "missing" | "wrong_day" | null;

export function badgeGateFor(convention: ConventionSummary): BadgeGate {
  if (convention === null || !convention.badgeRequiredForChildEvents) {
    return null;
  }
  if (convention.myBadgeStatus !== "confirmed") {
    return "missing";
  }
  return convention.myBadgeCoversThisEvent ? null : "wrong_day";
}

export type JoinActionInput = {
  tournament: Pick<
    PlayerTournamentEvent["tournament"],
    "lifecycle" | "entryFeeCents" | "registrationRequiresApproval"
  >;
  signedIn: boolean;
  // The viewer's row from getMyRegistration: undefined while it loads,
  // null when there is none. Ignored when signed out.
  registration: Pick<PlayerRegistration, "entryStatus"> | null | undefined;
  // getMyEntryOrder: undefined while it loads. Consulted only for a pending
  // entry on a paid event, the one case where it decides anything.
  order: Pick<EntryOrder, "status" | "purpose"> | null | undefined;
  badgeGate: BadgeGate;
  // getPublicTournament's convention.myBadgeCompsThisEvent.
  badgeCompsThisEvent: boolean;
  spotsLeft: number;
};

export function deriveJoinAction({
  tournament,
  signedIn,
  registration,
  order,
  badgeGate,
  badgeCompsThisEvent,
  spotsLeft,
}: JoinActionInput): JoinAction {
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
    case "confirmed":
      return { kind: "registered" };
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
        // Registration closed before they paid: nothing is left to do.
        if (!open) {
          return { kind: "closed" };
        }
        return badgeGate === null
          ? { kind: "completePayment", purpose: order.purpose }
          : { kind: "badgeBlocked", reason: badgeGate, canWithdraw: true };
      }
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
    return { kind: "badgeBlocked", reason: badgeGate, canWithdraw: false };
  }
  // A comped viewer never gets Checkout: the server refuses a comped
  // checkout and files the comp through registerSelf.
  const comped = isPaid && badgeCompsThisEvent;
  if (tournament.registrationRequiresApproval) {
    return { kind: "requestToRegister", comped };
  }
  return isPaid && !comped ? { kind: "pay" } : { kind: "register", comped };
}
