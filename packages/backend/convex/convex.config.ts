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
  },
});
app.use(rateLimiter);

export default app;
