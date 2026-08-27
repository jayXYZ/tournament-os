import {
  DEFAULT_FEE_CONFIG,
  type FeeConfig,
} from "@tournament-os/shared/payment-fees";

import { env } from "../_generated/server";

// Payments deployment configuration. All Stripe settings are optional in
// convex.config.ts so deployments without payments still deploy; functions
// that need one fail here with an actionable message instead of a missing-env
// crash deep inside a Stripe call.

export function requireStripeSecretKey() {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Payments are not configured: set STRIPE_SECRET_KEY on this deployment",
    );
  }
  return key;
}

export function requireStripeWebhookSecret() {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "Payments are not configured: set STRIPE_WEBHOOK_SECRET on this deployment",
    );
  }
  return secret;
}

export function requireWebAppOrigin() {
  const origin = env.WEB_APP_ORIGIN;
  if (!origin) {
    throw new Error(
      "Payments are not configured: set WEB_APP_ORIGIN on this deployment",
    );
  }
  return origin.replace(/\/+$/, "");
}

// Whether the payment surface can work at all on this deployment; the UI uses
// this to render a "not configured" notice instead of a button that throws.
// The webhook secret is part of "configured": without it checkout could still
// charge players while every fulfillment webhook fails verification, leaving
// them paid but unseated.
export function isStripeConfigured() {
  return Boolean(
    env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.WEB_APP_ORIGIN,
  );
}

// Fee economics from env with source-baked defaults (5% platform fee,
// 2.9% + 30¢ estimated Stripe fee). Percentages arrive as human-friendly
// strings ("5", "2.9") and convert to basis points; a malformed value falls
// back to its default rather than silently repricing every event.
export function feeConfigFromEnv(): FeeConfig {
  return {
    platformFeeBps:
      parsePercentToBps(env.PLATFORM_FEE_PERCENT) ??
      DEFAULT_FEE_CONFIG.platformFeeBps,
    stripeFeeBps:
      parsePercentToBps(env.STRIPE_FEE_PERCENT) ??
      DEFAULT_FEE_CONFIG.stripeFeeBps,
    stripeFixedCents:
      parseCents(env.STRIPE_FEE_FIXED_CENTS) ??
      DEFAULT_FEE_CONFIG.stripeFixedCents,
  };
}

// Strict parses: parseFloat/parseInt tolerate trailing garbage ("5oops" → 5)
// and silently truncate ("30.9" → 30), and orders snapshot the resulting
// price forever — so anything but a clean numeric value falls back to the
// default, loudly.
function parsePercentToBps(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  const percent = Number(value.trim());
  if (
    value.trim() === "" ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent >= 100
  ) {
    console.warn(
      `Ignoring malformed fee percent ${JSON.stringify(value)}; using the default`,
    );
    return null;
  }
  return Math.round(percent * 100);
}

function parseCents(value: string | undefined) {
  if (value === undefined) {
    return null;
  }
  const cents = Number(value.trim());
  if (value.trim() === "" || !Number.isInteger(cents) || cents < 0) {
    console.warn(
      `Ignoring malformed fee cents ${JSON.stringify(value)}; using the default`,
    );
    return null;
  }
  return cents;
}
