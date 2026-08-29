import { describe, expect, test } from "vitest";

import {
  DEFAULT_FEE_CONFIG,
  MAX_ENTRY_FEE_CENTS,
  MIN_ENTRY_FEE_CENTS,
  computeOrderBreakdown,
  estimatedStripeFeeCents,
  platformFeeCents,
  refundAmountCents,
  validateEntryFeeCents,
} from "./payment-fees";

describe("computeOrderBreakdown", () => {
  test("known example: $20.00 entry at default config", () => {
    // platform = 5% of 2000 = 100; total = ceil((2000+100+30)/0.971) = 2194
    const breakdown = computeOrderBreakdown(2000);
    expect(breakdown).toEqual({
      entryFeeCents: 2000,
      platformFeeCents: 100,
      processingFeeCents: 94,
      totalCents: 2194,
      currency: "usd",
    });
  });

  test("breakdown parts always sum to the total", () => {
    for (let entry = MIN_ENTRY_FEE_CENTS; entry <= 25_000; entry += 7) {
      const b = computeOrderBreakdown(entry);
      expect(b.entryFeeCents + b.platformFeeCents + b.processingFeeCents).toBe(
        b.totalCents,
      );
    }
  });

  test("margin property: the estimated Stripe fee on the total never eats into entry + platform fee", () => {
    const sweep = [];
    for (let entry = MIN_ENTRY_FEE_CENTS; entry <= 25_000; entry += 1) {
      sweep.push(entry);
    }
    sweep.push(123_457, 999_999, MAX_ENTRY_FEE_CENTS);

    for (const entry of sweep) {
      const b = computeOrderBreakdown(entry);
      const stripeFee = estimatedStripeFeeCents(
        b.totalCents,
        DEFAULT_FEE_CONFIG,
      );
      expect(b.totalCents - stripeFee).toBeGreaterThanOrEqual(
        b.entryFeeCents + b.platformFeeCents,
      );
    }
  });

  test("margin property holds for other configs", () => {
    const configs = [
      { platformFeeBps: 250, stripeFeeBps: 290, stripeFixedCents: 30 },
      { platformFeeBps: 1000, stripeFeeBps: 390, stripeFixedCents: 30 },
      { platformFeeBps: 0, stripeFeeBps: 290, stripeFixedCents: 30 },
      { platformFeeBps: 500, stripeFeeBps: 150, stripeFixedCents: 25 },
    ];
    for (const config of configs) {
      for (let entry = MIN_ENTRY_FEE_CENTS; entry <= 10_000; entry += 13) {
        const b = computeOrderBreakdown(entry, config);
        const stripeFee = estimatedStripeFeeCents(b.totalCents, config);
        expect(b.totalCents - stripeFee).toBeGreaterThanOrEqual(
          b.entryFeeCents + b.platformFeeCents,
        );
      }
    }
  });

  test("platform fee rounds half up on the entry fee alone", () => {
    // 5% of $0.50 = 2.5 cents -> 3
    expect(platformFeeCents(50, DEFAULT_FEE_CONFIG)).toBe(3);
    expect(platformFeeCents(2000, DEFAULT_FEE_CONFIG)).toBe(100);
  });
});

describe("refundAmountCents", () => {
  const breakdown = computeOrderBreakdown(2000);

  test("a full refund returns the whole charge", () => {
    expect(refundAmountCents(breakdown, "full")).toBe(breakdown.totalCents);
  });

  test("an entry-only refund keeps platform and processing fees", () => {
    expect(refundAmountCents(breakdown, "entry_only")).toBe(2000);
  });
});

describe("validateEntryFeeCents", () => {
  test("accepts whole-cent fees within bounds", () => {
    expect(validateEntryFeeCents(MIN_ENTRY_FEE_CENTS)).toBeNull();
    expect(validateEntryFeeCents(2000)).toBeNull();
    expect(validateEntryFeeCents(MAX_ENTRY_FEE_CENTS)).toBeNull();
  });

  test("rejects fractional, too-small, and too-large fees", () => {
    expect(validateEntryFeeCents(20.5)).toMatch(/whole number/);
    expect(validateEntryFeeCents(49)).toMatch(/at least/);
    expect(validateEntryFeeCents(MAX_ENTRY_FEE_CENTS + 1)).toMatch(/exceed/);
  });
});
