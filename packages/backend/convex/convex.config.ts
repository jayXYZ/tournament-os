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
  },
});
app.use(rateLimiter);

export default app;
