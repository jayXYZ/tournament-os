import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../_generated/server";
import {
  badgeBlocksRegistration,
  badgeForUser,
  isConventionRegistrationOpen,
  requireBadgeCapacityAvailable,
  requireConvention,
  resolveChildEventAdmission,
  setBadgeEntryStatus,
  upsertBadgeRow,
} from "../model/conventions";
import { inviteCodeGrantsAccess } from "../model/invites";
import { ensureParticipantForUser } from "../model/participants";
import { setRegistrationState } from "../model/participation";
import {
  createEntryOrder,
  isOpenOrderStatus,
  isPaidEvent,
  openOrderForRegistration,
  orderTransferGroup,
} from "../model/payments";
import {
  isPaidTicketType,
  requireTicketTypeCapacityAvailable,
  requireTicketTypeForConvention,
  requireTicketTypeOnSale,
} from "../model/ticketTypes";
import { tiebreakRandom } from "../model/random";
import {
  playerDisplayName,
  registrationForUser,
  requireCapacityAvailable,
} from "../model/registrations";
import { requireTournament } from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";
import { getStripeGateway, type StripeGateway } from "../stripe/client";
import { requireStripeSecretKey, requireWebAppOrigin } from "../stripe/config";
import { closeOpenOrdersForRegistration } from "./refunds";

// Entry-fee Checkout, for both kinds of paid entry: a tournament's entry fee
// and a convention's badge fee. One public action per kind serves the paid
// flows (a direct registration/badge purchase, and — for tournaments —
// completing payment after an organizer approval). The begin mutation
// files/reuses the pending entry row and its order, the action mints a
// Stripe-hosted Checkout Session, and fulfillment happens exclusively in
// the webhook (payments/webhooks.ts) — the seat is never taken here.

// What finding an existing registration row means for a checkout attempt.
// Mirrors registerSelf's existingEntryBlocksRegistration, with the one paid
// difference: a pending row holding a live order is this player's own
// checkout in flight, which the begin mutation reuses rather than refuses.
function entryBlocksCheckout(
  entryStatus: Doc<"tournamentRegistrations">["entryStatus"],
): string | null {
  switch (entryStatus) {
    case "confirmed":
      return "Already registered";
    case "pending":
      return "Your registration is pending review";
    case "waitlisted":
      return "You are on the waitlist for this event";
    case "rejected":
      return "Your registration was declined";
    case "cancelled":
      return null;
    default:
      throw new Error(
        `Unhandled registration entry status: ${entryStatus satisfies never}`,
      );
  }
}

export const beginEntryCheckout = internalMutation({
  args: {
    tournamentId: v.id("tournaments"),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "createCheckout");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (!isPaidEvent(tournament)) {
      throw new Error("This event has no entry fee");
    }
    const existing = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    // Same admission gates as registerSelf: open lifecycle, and a private
    // event admits a first-time payer only through its invite code — an
    // existing row is the standing re-admission for a player already let in.
    if (
      tournament.lifecycle !== "registration" ||
      (tournament.visibility === "private" &&
        existing === null &&
        !(await inviteCodeGrantsAccess(ctx, tournament, args.inviteCode)))
    ) {
      throw new Error("Tournament is not open for registration");
    }
    // A badge-gated child event admits paid self-registration only with a
    // confirmed convention badge, same as registerSelf.
    const admission = await resolveChildEventAdmission(
      ctx,
      tournament,
      user._id,
    );
    // A pass that comps this event registers free through registerSelf —
    // never through a paid checkout.
    if (admission.compedByBadge) {
      throw new Error(
        "Your convention badge includes this event — register directly instead of paying",
      );
    }

    let registration = existing;
    let order =
      existing === null
        ? null
        : await openOrderForRegistration(ctx, existing._id);

    if (tournament.registrationRequiresApproval) {
      // Approval mode: the free application was filed by registerSelf and
      // approveEntry created the payable order. Without one, this player has
      // nothing to pay yet.
      if (!existing || existing.entryStatus === "cancelled") {
        throw new Error(
          "This event requires organizer approval — request to register first",
        );
      }
      if (existing.entryStatus === "pending" && order === null) {
        throw new Error("Your registration is pending organizer approval");
      }
      const blockedBecause =
        existing.entryStatus === "pending"
          ? null
          : entryBlocksCheckout(existing.entryStatus);
      if (blockedBecause !== null) {
        throw new Error(blockedBecause);
      }
    } else {
      // Direct mode: file (or reuse) the pending row ourselves, exactly the
      // shape registerSelf gives an approval-mode application — no seat, no
      // participation status. A pending row with a live order is our own
      // earlier attempt; anything else refuses with the honest message.
      const blockedBecause =
        existing === null || (existing.entryStatus === "pending" && order)
          ? null
          : entryBlocksCheckout(existing.entryStatus);
      if (blockedBecause !== null) {
        throw new Error(blockedBecause);
      }
      requireCapacityAvailable(tournament);

      if (registration === null) {
        const now = Date.now();
        const participant = await ensureParticipantForUser(ctx, user._id);
        const registrationId = await ctx.db.insert("tournamentRegistrations", {
          tournamentId: args.tournamentId,
          participantId: participant._id,
          tournamentStartDate: tournament.startDate,
          entryStatus: "pending",
          playerName: playerDisplayName(user),
          createdAt: now,
          tiebreakRandom: tiebreakRandom(
            tournament.seed ?? tournament.publicCode,
            String(user.publicCode),
          ),
          updatedAt: now,
        });
        registration = (await ctx.db.get(registrationId))!;
      } else if (registration.entryStatus === "cancelled") {
        await setRegistrationState(ctx, registration._id, {
          entryStatus: "pending",
          playerName: playerDisplayName(user),
          tournamentStartDate: tournament.startDate,
          updatedAt: Date.now(),
        });
        registration = (await ctx.db.get(registration._id))!;
      }
    }

    if (!registration) {
      throw new Error("Registration not found");
    }
    order ??= await createEntryOrder(ctx, {
      owner: { kind: "tournament", event: tournament },
      registration,
      purpose: "registration",
    });

    const { checkoutAttempt, existingSessionId } = await bumpCheckoutAttempt(
      ctx,
      order,
    );

    return {
      orderId: order._id,
      checkoutAttempt,
      transferGroup: orderTransferGroup(order._id),
      totalCents: order.amountBreakdown.totalCents,
      productName: `${tournament.name} — entry`,
      tournamentPublicCode: String(tournament.publicCode),
      // A previous session to expire before minting the replacement, so two
      // live sessions can never both pay for one order.
      existingSessionId,
    };
  },
});

// The persisted attempt token, shared by both begins. It scopes the Stripe
// idempotency key (two begins always mint distinct sessions — a shared
// wall-clock key could hand two concurrent actions the same session, letting
// the attach loser expire the session the winner just gave its player) and
// is the attach compare-and-set: any newer begin invalidates this attempt's
// attach.
//
// Detaching the superseded session here — before the action expires it —
// keeps the expiry webhook from reading the supersede as an abandonment:
// with the session gone and the order back in requires_payment, the
// checkout.session.expired handler no-ops instead of closing the order and
// cancelling the entry under the replacement attempt's feet. A payment that
// still completes on the detached session finds the order open and seats
// normally until the replacement attaches; after that it is a stray charge
// and refunds (payments/webhooks.ts).
//
// Detaching must not forget: the session moves to supersededSessionId
// (carrying forward one an earlier begin parked there) rather than
// vanishing, so a retry after a failed supersede proof still has to prove
// the same session dead before minting — otherwise a "complete" session
// whose webhook hasn't landed could be paid over twice.
async function bumpCheckoutAttempt(
  ctx: MutationCtx,
  order: Doc<"paymentOrders">,
) {
  const checkoutAttempt = (order.checkoutAttempt ?? 0) + 1;
  const existingSessionId =
    order.stripeCheckoutSessionId ?? order.supersededSessionId ?? null;
  await ctx.db.patch(order._id, {
    checkoutAttempt,
    stripeCheckoutSessionId: undefined,
    supersededSessionId: existingSessionId ?? undefined,
    ...(order.status === "awaiting_payment"
      ? { status: "requires_payment" as const }
      : {}),
    updatedAt: Date.now(),
  });
  return { checkoutAttempt, existingSessionId };
}

// The badge-fee begin: files/reuses the pending badge row and its order for
// the chosen ticket type. Simpler than the tournament begin — badges have
// no approval mode and no invite links, so a private convention admits a
// first-time payer never, and an existing row is the standing re-admission.
export const beginBadgeCheckout = internalMutation({
  args: {
    conventionId: v.id("conventions"),
    ticketTypeId: v.id("conventionTicketTypes"),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "createCheckout");
    const user = await ensureCurrentUser(ctx);
    const convention = await requireConvention(ctx, args.conventionId);
    const ticketType = await requireTicketTypeForConvention(
      ctx,
      convention,
      args.ticketTypeId,
    );
    if (!isPaidTicketType(ticketType)) {
      throw new Error("This ticket is free — register directly");
    }
    const existing = await badgeForUser(ctx, args.conventionId, user._id);
    if (
      !isConventionRegistrationOpen(convention) ||
      (convention.visibility === "private" && existing === null)
    ) {
      throw new Error("Convention registration is not open");
    }
    // The sale window gates beginning a purchase only; the webhook's seat
    // decision deliberately re-checks lifecycle and capacity but not this
    // (model/ticketTypes.ts isTicketTypeOnSale).
    requireTicketTypeOnSale(convention, ticketType);

    let order =
      existing === null
        ? null
        : await openOrderForRegistration(ctx, existing._id);
    // A pending row with a live order is our own earlier attempt; anything
    // else refuses with the honest message.
    const blockedBecause =
      existing === null || (existing.entryStatus === "pending" && order)
        ? null
        : badgeBlocksRegistration(existing.entryStatus);
    if (blockedBecause !== null) {
      throw new Error(blockedBecause);
    }
    requireBadgeCapacityAvailable(convention);
    requireTicketTypeCapacityAvailable(ticketType);

    // A live order for a DIFFERENT pass is never repriced — its breakdown
    // is a frozen snapshot of the old type. Close it (its session expires
    // through the usual sweep; a payment landing anyway refunds as a late
    // success) and mint a fresh order for the requested type.
    if (order && order.ticketTypeId !== ticketType._id) {
      await closeOpenOrdersForRegistration(ctx, existing!._id);
      order = null;
    }

    const badge =
      existing !== null && existing.entryStatus === "pending"
        ? existing
        : await upsertBadgeRow(ctx, {
            convention,
            ticketType,
            user,
            entryStatus: "pending",
          });
    // A reused pending row switching passes re-stamps the type.
    if (badge.ticketTypeId !== ticketType._id) {
      await setBadgeEntryStatus(ctx, badge._id, {
        entryStatus: "pending",
        ticketTypeId: ticketType._id,
        updatedAt: Date.now(),
      });
    }

    order ??= await createEntryOrder(ctx, {
      owner: { kind: "convention", event: convention, ticketType },
      registration: badge,
      purpose: "registration",
    });

    const { checkoutAttempt, existingSessionId } = await bumpCheckoutAttempt(
      ctx,
      order,
    );

    return {
      orderId: order._id,
      checkoutAttempt,
      transferGroup: orderTransferGroup(order._id),
      totalCents: order.amountBreakdown.totalCents,
      productName: `${convention.name} — ${ticketType.name}`,
      conventionPublicCode: String(convention.publicCode),
      existingSessionId,
    };
  },
});

// Compare-and-swap on the attempt token: the attach succeeds only if no
// newer beginEntryCheckout ran since this attempt's begin. Returns false
// when the caller lost — a concurrent checkout began a newer attempt, or a
// webhook closed the order mid-flight — and the caller must then expire the
// session it minted, so an unattached session is never left payable (a
// payment on it would arrive at the webhook unrecognized).
export const attachCheckoutSession = internalMutation({
  args: {
    orderId: v.id("paymentOrders"),
    stripeCheckoutSessionId: v.string(),
    checkoutAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    // A webhook may have closed the order between session creation and this
    // write (expiry of the prior session, a cancellation): never reopen it.
    if (!isOpenOrderStatus(order.status)) {
      return false;
    }
    // A rival begin superseded this attempt; its attach owns the order now.
    if (order.checkoutAttempt !== args.checkoutAttempt) {
      return false;
    }
    await ctx.db.patch(args.orderId, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      // The replacement only minted because the superseded session was
      // proven dead (expired, never paid), so the memory of it can go.
      supersededSessionId: undefined,
      status: "awaiting_payment",
      updatedAt: Date.now(),
    });
    return true;
  },
});

// Fire-and-forget session expiry for orders closed by a withdrawal or
// rejection, so an abandoned Checkout page can never still take money.
export const expireAbandonedSession = internalAction({
  args: { sessionId: v.string() },
  handler: async (_ctx, args) => {
    const gateway = getStripeGateway(requireStripeSecretKey());
    try {
      await gateway.expireCheckoutSession({ sessionId: args.sessionId });
    } catch {
      // Already completed or expired — the webhook owns either outcome.
    }
    return null;
  },
});

type CheckoutBegin = {
  orderId: Id<"paymentOrders">;
  checkoutAttempt: number;
  transferGroup: string;
  totalCents: number;
  productName: string;
  existingSessionId: string | null;
};

// The action half both checkouts share: prove any previous session dead,
// mint the replacement, and attach it under the attempt token's
// compare-and-swap.
async function mintAndAttachSession(
  ctx: ActionCtx,
  gateway: StripeGateway,
  begin: CheckoutBegin,
  eventUrl: string,
): Promise<{ url: string }> {
  if (begin.existingSessionId) {
    // The old session must be provably dead before a replacement is
    // minted: a payment completing on it after the order moves on would
    // reach the webhook unrecognized and be discarded. Expiring an open
    // session guarantees Stripe never takes money on it; when it cannot be
    // expired, only an already-expired session is safe to replace — a
    // completed one has a payment racing the webhook.
    let superseded = false;
    try {
      await gateway.expireCheckoutSession({
        sessionId: begin.existingSessionId,
      });
      superseded = true;
    } catch {
      const status = await gateway.retrieveCheckoutSessionStatus({
        sessionId: begin.existingSessionId,
      });
      superseded = status === "expired";
    }
    if (!superseded) {
      throw new Error(
        "Your previous checkout is still being processed — please wait a moment and refresh",
      );
    }
  }

  const { sessionId, url } = await gateway.createCheckoutSession({
    orderId: begin.orderId,
    productName: begin.productName,
    totalCents: begin.totalCents,
    transferGroup: begin.transferGroup,
    successUrl: `${eventUrl}/payment?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: eventUrl,
    // Keyed by the persisted attempt token: SDK-level retries of this one
    // request replay as the same session, while distinct begins always
    // mint distinct sessions. Concurrent attempts are resolved by the
    // attach compare-and-swap below.
    idempotencyKey: `checkout:${begin.orderId}:${begin.checkoutAttempt}`,
  });

  const attached: boolean = await ctx.runMutation(
    internal.payments.checkout.attachCheckoutSession,
    {
      orderId: begin.orderId,
      stripeCheckoutSessionId: sessionId,
      checkoutAttempt: begin.checkoutAttempt,
    },
  );
  if (!attached) {
    // Lost the attach race, or the order closed mid-flight. This session's
    // URL was never returned to anyone, so expiring it strands no payer.
    try {
      await gateway.expireCheckoutSession({ sessionId });
    } catch {
      // Nothing left to protect; the webhook owns any late event.
    }
    throw new Error(
      "Another checkout for this entry is already in progress — please try again",
    );
  }

  return { url };
}

// Public entry point for both paid tournament flows; returns the
// Stripe-hosted Checkout URL the client redirects to.
export const createEntryCheckout = action({
  args: {
    tournamentId: v.id("tournaments"),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const secretKey = requireStripeSecretKey();
    const origin = requireWebAppOrigin();
    const gateway = getStripeGateway(secretKey);

    const begin: CheckoutBegin & { tournamentPublicCode: string } =
      await ctx.runMutation(internal.payments.checkout.beginEntryCheckout, {
        tournamentId: args.tournamentId,
        inviteCode: args.inviteCode,
      });

    const eventUrl = `${origin}/tournaments/${begin.tournamentPublicCode}`;
    return await mintAndAttachSession(ctx, gateway, begin, eventUrl);
  },
});

// The badge-fee twin: the public entry point for a convention badge
// purchase of one ticket type.
export const createBadgeCheckout = action({
  args: {
    conventionId: v.id("conventions"),
    ticketTypeId: v.id("conventionTicketTypes"),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const secretKey = requireStripeSecretKey();
    const origin = requireWebAppOrigin();
    const gateway = getStripeGateway(secretKey);

    const begin: CheckoutBegin & { conventionPublicCode: string } =
      await ctx.runMutation(internal.payments.checkout.beginBadgeCheckout, {
        conventionId: args.conventionId,
        ticketTypeId: args.ticketTypeId,
      });

    const eventUrl = `${origin}/conventions/${begin.conventionPublicCode}`;
    return await mintAndAttachSession(ctx, gateway, begin, eventUrl);
  },
});
