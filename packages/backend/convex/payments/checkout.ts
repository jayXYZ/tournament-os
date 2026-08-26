import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalAction, internalMutation } from "../_generated/server";
import { ensureParticipantForUser } from "../model/participants";
import { setRegistrationState } from "../model/participation";
import {
  createEntryOrder,
  isPaidTournament,
  openOrderForRegistration,
  orderTransferGroup,
} from "../model/payments";
import { tiebreakRandom } from "../model/random";
import {
  playerDisplayName,
  registrationForUser,
  requireCapacityAvailable,
} from "../model/registrations";
import { requireTournament } from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";
import { getStripeGateway } from "../stripe/client";
import { requireStripeSecretKey, requireWebAppOrigin } from "../stripe/config";

// Entry-fee Checkout. One public action serves both paid flows: a direct
// registration ("Register — $X") and completing payment after an organizer
// approval. The begin mutation files/reuses the pending registration and its
// order, the action mints a Stripe-hosted Checkout Session, and fulfillment
// happens exclusively in the webhook (payments/webhooks.ts) — the seat is
// never taken here.

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
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "createCheckout");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (!isPaidTournament(tournament)) {
      throw new Error("This event has no entry fee");
    }
    const existing = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    // Same admission gates as registerSelf: open lifecycle, and a private
    // event only re-admits a player who already holds a row for it.
    if (
      tournament.lifecycle !== "registration" ||
      (tournament.visibility === "private" && existing === null)
    ) {
      throw new Error("Tournament is not open for registration");
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
      tournament,
      registration,
      purpose: "registration",
    });

    return {
      orderId: order._id,
      transferGroup: orderTransferGroup(order._id),
      totalCents: order.amountBreakdown.totalCents,
      productName: `${tournament.name} — entry`,
      tournamentPublicCode: String(tournament.publicCode),
      // A previous session to expire before minting the replacement, so two
      // live sessions can never both pay for one order.
      existingSessionId: order.stripeCheckoutSessionId ?? null,
    };
  },
});

export const attachCheckoutSession = internalMutation({
  args: {
    orderId: v.id("paymentOrders"),
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    // A webhook may have closed the order between session creation and this
    // write (expiry of the prior session, a cancellation): never reopen it.
    if (
      order.status !== "requires_payment" &&
      order.status !== "awaiting_payment"
    ) {
      return null;
    }
    await ctx.db.patch(args.orderId, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      status: "awaiting_payment",
      updatedAt: Date.now(),
    });
    return null;
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

// Public entry point for both paid flows; returns the Stripe-hosted Checkout
// URL the client redirects to.
export const createEntryCheckout = action({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const secretKey = requireStripeSecretKey();
    const origin = requireWebAppOrigin();
    const gateway = getStripeGateway(secretKey);

    const begin: {
      orderId: Id<"paymentOrders">;
      transferGroup: string;
      totalCents: number;
      productName: string;
      tournamentPublicCode: string;
      existingSessionId: string | null;
    } = await ctx.runMutation(internal.payments.checkout.beginEntryCheckout, {
      tournamentId: args.tournamentId,
    });

    if (begin.existingSessionId) {
      // Best-effort: an already-expired or already-completed session throws,
      // and the webhook handles either outcome — the point is only that no
      // superseded session stays payable.
      try {
        await gateway.expireCheckoutSession({
          sessionId: begin.existingSessionId,
        });
      } catch {
        // Ignored; see above.
      }
    }

    const eventUrl = `${origin}/tournaments/${begin.tournamentPublicCode}`;
    const { sessionId, url } = await gateway.createCheckoutSession({
      orderId: begin.orderId,
      productName: begin.productName,
      totalCents: begin.totalCents,
      transferGroup: begin.transferGroup,
      successUrl: `${eventUrl}/payment?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: eventUrl,
      // Each click deliberately mints a fresh session (the prior one was
      // expired above), so the key varies per attempt.
      idempotencyKey: `checkout:${begin.orderId}:${Date.now()}`,
    });

    await ctx.runMutation(internal.payments.checkout.attachCheckoutSession, {
      orderId: begin.orderId,
      stripeCheckoutSessionId: sessionId,
    });

    return { url };
  },
});
