import { v } from "convex/values";

import { env, internalMutation } from "./_generated/server";

// Seeding hooks for test runs against a personal dev deployment (the native
// join E2E in apps/native/e2e). Everything else those runs need goes through
// the public mutations, called with `convex run --identity`; this module
// holds only state no public mutation can produce without a real provider
// round trip. Internal, so only the CLI or dashboard can run it.

// A development deployment authenticates against a Clerk development
// instance, whose issuer is always a *.clerk.accounts.dev host; production
// instances are served from the app's own domain. Refusing anything else
// keeps these writes off a production deployment even when the CLI is
// pointed at one.
function requireDevelopmentDeployment() {
  const issuer = new URL(env.CLERK_JWT_ISSUER_DOMAIN).hostname;
  if (!issuer.endsWith(".clerk.accounts.dev")) {
    throw new Error(
      "devSeed runs only on a development deployment (Clerk development instance)",
    );
  }
  // Checkout charges the platform account, not the stand-in (see
  // markOrganizationPayoutsReady), so a live key would take real money for
  // a seeded paid event. Only a test-mode key, or none, is allowed — an
  // allow-list, so a key of any other shape is refused rather than let
  // through. Trimmed first, so a key pasted with stray whitespace counts
  // as what it is, test or live.
  const stripeKey = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (stripeKey !== "" && !/^(sk|rk)_test_/.test(stripeKey)) {
    throw new Error(
      "devSeed runs only with a test-mode Stripe key or none (STRIPE_SECRET_KEY)",
    );
  }
}

// Paid events and paid ticket types require the organization's Stripe
// account to be payouts-ready (model/payments.ts
// requirePayoutsReadyOrganization), which only Connect onboarding produces.
// This records a stand-in account so the public setup mutations accept a
// fee. Checkout does not involve it: the charge lands on the platform
// account (separate charges and transfers, stripe/client.ts
// createCheckoutSession), so with the deployment's test-mode key a seeded
// paid event takes a test payment like any other. What fails is the payout,
// whose transfer names the stand-in's made-up account id.
export const markOrganizationPayoutsReady = internalMutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    requireDevelopmentDeployment();
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        transfersCapabilityStatus: "active",
        payoutsReady: true,
        lastSyncedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("organizationStripeAccounts", {
      organizationId: args.organizationId,
      stripeAccountId: `acct_devseed_${args.organizationId}`,
      country: "us",
      transfersCapabilityStatus: "active",
      payoutsReady: true,
      lastSyncedAt: now,
      createdBy: organization.createdBy,
      updatedAt: now,
    });
  },
});
