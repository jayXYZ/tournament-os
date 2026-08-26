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
export function isStripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY && env.WEB_APP_ORIGIN);
}
