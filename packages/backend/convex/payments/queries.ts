import { v } from "convex/values";

import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

import { query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { badgeForUser } from "../model/conventions";
import {
  hasPriorPlayerCancelFullRefund,
  ordersForRegistration,
  refundWindowOpen,
} from "../model/payments";
import { registrationForUser } from "../model/registrations";
import { feeConfigFromEnv } from "../stripe/config";

// What a player would pay for a given entry fee, from the same shared math
// and env config the order writer uses, so no client ever re-implements the
// breakdown. Pure arithmetic over public fee policy — no auth required.
export const getFeePreview = query({
  args: { entryFeeCents: v.number() },
  handler: async (_ctx, args) => {
    const message = validateEntryFeeCents(args.entryFeeCents);
    if (message) {
      throw new Error(message);
    }
    return computeOrderBreakdown(args.entryFeeCents, feeConfigFromEnv());
  },
});

// The caller's latest entry order for a tournament — what the registration
// panel and the payment return page render. Reactive: the webhook's write
// flips this the moment fulfillment lands.
export const getMyEntryOrder = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      return null;
    }
    const orders = await ordersForRegistration(ctx, registration._id);
    const order = orders[0];
    if (!order) {
      return null;
    }

    // What cancelling would do to this payment right now — the same rules
    // settleOrdersOnEntryExit applies (payments/refunds.ts), computed
    // server-side so the cancel button's warning can never drift from what
    // confirming it does.
    let cancelOutcome:
      | "full_refund"
      | "entry_only_refund"
      | "no_refund"
      | null = null;
    if (order.status === "paid") {
      const tournament = await ctx.db.get(args.tournamentId);
      if (tournament) {
        cancelOutcome = !refundWindowOpen(tournament, Date.now())
          ? "no_refund"
          : (await hasPriorPlayerCancelFullRefund(
                ctx,
                { kind: "tournament", event: tournament },
                registration.participantId,
              ))
            ? "entry_only_refund"
            : "full_refund";
      }
    }

    return {
      status: order.status,
      purpose: order.purpose,
      amountBreakdown: order.amountBreakdown,
      cancelOutcome,
    };
  },
});

// The badge twin of getMyEntryOrder: the caller's latest badge order for a
// convention — what the badge panel and the payment return page render.
export const getMyBadgeOrder = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }
    const badge = await badgeForUser(ctx, args.conventionId, user._id);
    if (!badge) {
      return null;
    }
    const orders = await ordersForRegistration(ctx, badge._id);
    const order = orders[0];
    if (!order) {
      return null;
    }

    let cancelOutcome:
      | "full_refund"
      | "entry_only_refund"
      | "no_refund"
      | null = null;
    if (order.status === "paid") {
      const convention = await ctx.db.get(args.conventionId);
      if (convention) {
        cancelOutcome = !refundWindowOpen(convention, Date.now())
          ? "no_refund"
          : (await hasPriorPlayerCancelFullRefund(
                ctx,
                { kind: "convention", event: convention },
                badge.participantId,
              ))
            ? "entry_only_refund"
            : "full_refund";
      }
    }

    return {
      status: order.status,
      purpose: order.purpose,
      amountBreakdown: order.amountBreakdown,
      cancelOutcome,
    };
  },
});

// Whether the caller already took an automatic full refund for cancelling
// out of this tournament — the repeat-drop warning shown before they pay
// again ("drop again and only the entry cost is refunded").
export const getMyRefundFlag = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return { repeatDropFeesKept: false };
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      return { repeatDropFeesKept: false };
    }
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return { repeatDropFeesKept: false };
    }
    return {
      repeatDropFeesKept: await hasPriorPlayerCancelFullRefund(
        ctx,
        { kind: "tournament", event: tournament },
        registration.participantId,
      ),
    };
  },
});

// The badge twin of getMyRefundFlag: the repeat-drop warning before a
// caller pays for a badge again.
export const getMyBadgeRefundFlag = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return { repeatDropFeesKept: false };
    }
    const badge = await badgeForUser(ctx, args.conventionId, user._id);
    const convention = badge ? await ctx.db.get(args.conventionId) : null;
    if (!badge || !convention) {
      return { repeatDropFeesKept: false };
    }
    return {
      repeatDropFeesKept: await hasPriorPlayerCancelFullRefund(
        ctx,
        { kind: "convention", event: convention },
        badge.participantId,
      ),
    };
  },
});
