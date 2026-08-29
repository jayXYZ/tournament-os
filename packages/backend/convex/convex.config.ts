import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp({
  env: {
    // Clerk JWT issuer URL; auth.config.ts refuses to deploy without it.
    CLERK_JWT_ISSUER_DOMAIN: v.string(),
    // Encrypts profile-results pagination cursors. Optional because dev/test
    // deployments fall back to a source-baked constant (see
    // model/playerResults.ts); production must set a real secret.
    PROFILE_RESULTS_CURSOR_KEY: v.optional(v.string()),
    // Stripe payments: the platform's restricted secret key and the webhook
    // endpoint's signing secret. Optional so deployments without payments
    // still deploy; payment functions refuse with an actionable error when
    // unset (see convex/stripe/config.ts).
    STRIPE_SECRET_KEY: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET: v.optional(v.string()),
    // Web app origin for Stripe redirect URLs (Connect onboarding
    // return/refresh, Checkout success/cancel), e.g. https://example.com.
    // Stripe requires HTTPS for Account Link URLs even in test mode.
    WEB_APP_ORIGIN: v.optional(v.string()),
    // Fee economics overrides (see @tournament-os/shared/payment-fees and
    // convex/stripe/config.ts): the platform's cut as a percentage of the
    // entry fee, and the estimated Stripe processing fee as a percentage of
    // the charge total plus a fixed per-charge amount in cents. Defaults:
    // 5 / 2.9 / 30.
    PLATFORM_FEE_PERCENT: v.optional(v.string()),
    STRIPE_FEE_PERCENT: v.optional(v.string()),
    STRIPE_FEE_FIXED_CENTS: v.optional(v.string()),
  },
});
app.use(rateLimiter);

export default app;
