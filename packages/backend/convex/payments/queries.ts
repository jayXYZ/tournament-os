import { v } from "convex/values";

import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

import { query, type QueryCtx } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { badgeForUser } from "../model/conventions";
import type { AnyEntryRegistration, PaidEventRef } from "../model/payments";
import {
  hasPriorPlayerCancelFullRefund,
  latestOrderForRegistration,
  paidEntryCancelOutcome,
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

// The registration's newest order shaped for the payment panels, with the
// server-computed consequence of cancelling right now (the same rules
// settleOrdersOnEntryExit applies — paidEntryCancelOutcome), so the cancel
// button's warning can never drift from what confirming it does. Shared by
// both entry kinds so tournament and badge behavior cannot diverge.
async function entryOrderView(
  ctx: QueryCtx,
  owner: PaidEventRef,
  registration: AnyEntryRegistration,
) {
  const order = await latestOrderForRegistration(ctx, registration._id);
  if (!order) {
    return null;
  }
  return {
    status: order.status,
    purpose: order.purpose,
    amountBreakdown: order.amountBreakdown,
    cancelOutcome: await paidEntryCancelOutcome(
      ctx,
      owner,
      order,
      registration.participantId,
    ),
  };
}

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
    const tournament = registration
      ? await ctx.db.get(args.tournamentId)
      : null;
    if (!registration || !tournament) {
      return null;
    }
    return await entryOrderView(
      ctx,
      { kind: "tournament", event: tournament },
      registration,
    );
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
    const convention = badge ? await ctx.db.get(args.conventionId) : null;
    if (!badge || !convention) {
      return null;
    }
    return await entryOrderView(
      ctx,
      { kind: "convention", event: convention },
      badge,
    );
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
    const tournament = registration
      ? await ctx.db.get(args.tournamentId)
      : null;
    if (!registration || !tournament) {
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
