import { v } from "convex/values";

import {
  computeOrderBreakdown,
  validateEntryFeeCents,
} from "@tournament-os/shared/payment-fees";

import { query } from "../_generated/server";
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
