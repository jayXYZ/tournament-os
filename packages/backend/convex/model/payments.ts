import { validateEntryFeeCents } from "@tournament-os/shared/payment-fees";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { stripeAccountForOrganization } from "./stripeAccounts";

// Paid-event domain rules. The presence of entryFeeCents is what makes a
// tournament paid; everything money-shaped hangs off order records rather
// than registration state (TODO.md §9: never overload registration status).

export function isPaidTournament(tournament: Doc<"tournaments">) {
  return (tournament.entryFeeCents ?? 0) > 0;
}

export function requireValidEntryFee(entryFeeCents: number) {
  const message = validateEntryFeeCents(entryFeeCents);
  if (message) {
    throw new Error(message);
  }
  return entryFeeCents;
}

// Charging players is only allowed once the organization can actually be
// paid out, so a paid event can never strand funds on the platform behind an
// unfinished onboarding.
export async function requirePayoutsReadyOrganization(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const account = await stripeAccountForOrganization(ctx, organizationId);
  if (!account?.payoutsReady) {
    throw new Error(
      "Connect the organization's Stripe account before setting an entry fee",
    );
  }
  return account;
}
