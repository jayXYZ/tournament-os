import { v } from "convex/values";

import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

import { query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { ordersForRegistration } from "../model/payments";
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
    return {
      status: order.status,
      purpose: order.purpose,
      amountBreakdown: order.amountBreakdown,
    };
  },
});
