// Entry-fee economics for paid events. The organizer's payout per paid player
// is exactly the tournament's entry fee; the player additionally absorbs the
// platform's flat percentage of the entry fee and an estimate of Stripe's
// processing fee, grossed up so the estimated fee on the grossed-up total
// still leaves the platform its margin. All amounts are integer USD cents.
//
// The Stripe portion is an ESTIMATE (rates vary by card and region); the
// variance between the estimate and Stripe's actual per-charge fee lands on
// the platform and is monitored via Stripe's margin reports. The breakdown
// for an order is computed once at order creation and stored — config
// changes never reprice open orders.

export type FeeConfig = {
  // Platform's cut as basis points of the entry fee (500 = 5%).
  platformFeeBps: number;
  // Estimated Stripe processing fee: percentage of the charge total in basis
  // points (290 = 2.9%) plus a fixed per-charge amount in cents.
  stripeFeeBps: number;
  stripeFixedCents: number;
};

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  platformFeeBps: 500,
  stripeFeeBps: 290,
  stripeFixedCents: 30,
};

// Stripe's per-currency charge minimum is $0.50; the cap just bounds typos.
export const MIN_ENTRY_FEE_CENTS = 50;
export const MAX_ENTRY_FEE_CENTS = 1_000_000;

export type RefundKind = "full" | "entry_only";

export type OrderAmountBreakdown = {
  entryFeeCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  totalCents: number;
  currency: "usd";
};

export function platformFeeCents(entryFeeCents: number, config: FeeConfig) {
  return Math.round((entryFeeCents * config.platformFeeBps) / 10000);
}

// Stripe's estimated fee for a given charge total, matching how Stripe
// computes it (percentage of the total, rounded, plus the fixed part).
export function estimatedStripeFeeCents(totalCents: number, config: FeeConfig) {
  return (
    Math.round((totalCents * config.stripeFeeBps) / 10000) +
    config.stripeFixedCents
  );
}

// The player's charge total: the smallest amount whose estimated Stripe fee
// still leaves at least entry + platform fee. Derived from
//   total − (total × pct + fixed) ≥ entry + platform
// so the ceil guarantees the margin property for every entry fee (the
// payment-fees test sweeps it).
export function computeOrderBreakdown(
  entryFeeCents: number,
  config: FeeConfig = DEFAULT_FEE_CONFIG,
): OrderAmountBreakdown {
  const platform = platformFeeCents(entryFeeCents, config);
  const total = Math.ceil(
    ((entryFeeCents + platform + config.stripeFixedCents) * 10000) /
      (10000 - config.stripeFeeBps),
  );
  return {
    entryFeeCents,
    platformFeeCents: platform,
    processingFeeCents: total - entryFeeCents - platform,
    totalCents: total,
    currency: "usd",
  };
}

// A first pre-deadline drop refunds everything; a repeat drop (after a prior
// automatic full refund for the same tournament) refunds the entry cost only,
// so serial sign-up-and-drop cannot farm processing fees.
export function refundAmountCents(
  breakdown: Pick<OrderAmountBreakdown, "entryFeeCents" | "totalCents">,
  kind: RefundKind,
) {
  return kind === "full" ? breakdown.totalCents : breakdown.entryFeeCents;
}

export function validateEntryFeeCents(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Entry fee must be a whole number of cents";
  }
  if (value < MIN_ENTRY_FEE_CENTS) {
    return "Entry fee must be at least $0.50";
  }
  if (value > MAX_ENTRY_FEE_CENTS) {
    return "Entry fee cannot exceed $10,000";
  }
  return null;
}
