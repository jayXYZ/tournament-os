import {
  isSupportedStripeCountry,
  type StripeCountry,
  UNSUPPORTED_STRIPE_COUNTRY_MESSAGE,
} from "@paper-pairings/shared/payment-fees";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action, internalMutation, query } from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import {
  applyStripeAccountStatus,
  requirePaymentsPermission,
  stripeAccountByStripeAccountId,
  stripeAccountForOrganization,
} from "../model/stripeAccounts";
import { enforceRateLimit } from "../rateLimits";
import { getStripeGateway } from "../stripe/client";
import type { TransfersCapabilityStatus } from "../stripe/client";
import {
  isStripeConfigured,
  requireStripeSecretKey,
  requireWebAppOrigin,
} from "../stripe/config";
import {
  canManageOrganizationPayments,
  stripeTransfersCapabilityStatusValidator,
} from "../validators";

// Stripe Connect onboarding for organizations. The flow follows the app's
// external-redirect shape (mutation/action → redirect → return route): an
// action mints a Stripe-hosted onboarding link, the browser leaves for
// Stripe, and the return route refreshes our capability snapshot. Actions
// cannot touch the database, so each one opens with an internalMutation that
// debits the rate limit and checks permission before any Stripe call.

export const getOrganizationPaymentSettings = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const account = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );

    return {
      canManage: canManageOrganizationPayments(membership.role),
      // Whether this deployment has Stripe env configured at all; the UI
      // shows a notice instead of a connect button when it does not.
      stripeConfigured: isStripeConfigured(),
      connection: account
        ? {
            transfersCapabilityStatus: account.transfersCapabilityStatus,
            payoutsReady: account.payoutsReady,
            lastSyncedAt: account.lastSyncedAt,
          }
        : null,
    };
  },
});

export const beginStripeOnboarding = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "stripeOnboarding");
    const { organization, user } = await requirePaymentsPermission(
      ctx,
      args.organizationId,
    );
    const existing = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );

    // A re-entry for an existing account never creates anything, so the
    // first-connect requirements below only apply when there is no account.
    if (existing) {
      return {
        existingStripeAccountId: existing.stripeAccountId,
        organizationName: organization.name,
        contactEmail: user.email ?? null,
        country: null,
      };
    }

    // Stripe refuses a recipient-configured account without a contact email.
    if (!user.email) {
      throw new Error(
        "Add an email address to your account before connecting Stripe",
      );
    }
    // The country is fixed once the account exists and the platform is
    // USD-only, so an unsupported country is refused here — before any
    // Stripe call — instead of minting an account that can never finish
    // onboarding. The UI collects it as an explicit acknowledgement.
    if (!args.country) {
      throw new Error(
        "Confirm the organization's country before connecting Stripe",
      );
    }
    const country = args.country.toLowerCase();
    if (!isSupportedStripeCountry(country)) {
      throw new Error(UNSUPPORTED_STRIPE_COUNTRY_MESSAGE);
    }
    return {
      existingStripeAccountId: null,
      organizationName: organization.name,
      contactEmail: user.email,
      country,
    };
  },
});

export const recordStripeAccountCreated = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    stripeAccountId: v.string(),
    country: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requirePaymentsPermission(ctx, args.organizationId);
    const existing = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );
    if (existing) {
      // Lost a concurrent-onboarding race; the first recorded account wins
      // and the extra Stripe account is abandoned (it holds no data yet).
      return { stripeAccountId: existing.stripeAccountId };
    }

    const now = Date.now();
    await ctx.db.insert("organizationStripeAccounts", {
      organizationId: args.organizationId,
      stripeAccountId: args.stripeAccountId,
      country: args.country,
      transfersCapabilityStatus: "pending",
      payoutsReady: false,
      lastSyncedAt: now,
      createdBy: user._id,
      updatedAt: now,
    });
    return { stripeAccountId: args.stripeAccountId };
  },
});

export const beginStripeStatusRefresh = internalMutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "refreshStripeStatus");
    await requirePaymentsPermission(ctx, args.organizationId);
    const account = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );
    return { stripeAccountId: account?.stripeAccountId ?? null };
  },
});

export const recordStripeAccountStatus = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    transfersCapabilityStatus: stripeTransfersCapabilityStatusValidator,
  },
  handler: async (ctx, args) => {
    const account = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );
    if (!account) {
      throw new Error("Stripe account not found");
    }
    await applyStripeAccountStatus(
      ctx,
      account,
      args.transfersCapabilityStatus,
    );
    return null;
  },
});

// Webhook-driven snapshot write (http.ts `/stripe/account-events`): the event
// names the connected account, not the organization. An account this
// deployment never recorded (another environment's, or an abandoned
// concurrent-onboarding loser) is ignored, not an error — Stripe should not
// retry it.
export const recordStripeAccountStatusByAccountId = internalMutation({
  args: {
    stripeAccountId: v.string(),
    transfersCapabilityStatus: stripeTransfersCapabilityStatusValidator,
  },
  handler: async (ctx, args) => {
    const account = await stripeAccountByStripeAccountId(
      ctx,
      args.stripeAccountId,
    );
    if (!account) {
      return false;
    }
    await applyStripeAccountStatus(
      ctx,
      account,
      args.transfersCapabilityStatus,
    );
    return true;
  },
});

export const beginStripeDashboardLink = internalMutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "stripeDashboardLink");
    await requirePaymentsPermission(ctx, args.organizationId);
    const account = await stripeAccountForOrganization(
      ctx,
      args.organizationId,
    );
    return { stripeAccountId: account?.stripeAccountId ?? null };
  },
});

// Mints a Stripe-hosted onboarding link for the organization's connected
// account, creating the account first if this is the organization's first
// visit. The same action serves "connect", "continue onboarding", and the
// refresh_url re-entry (Stripe links are single-use and short-lived). A
// first-time connect must name the organization's country (checked against
// SUPPORTED_STRIPE_COUNTRIES); re-entries ignore it.
export const createOnboardingLink = action({
  args: {
    organizationId: v.id("organizations"),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const secretKey = requireStripeSecretKey();
    const origin = requireWebAppOrigin();
    const gateway = getStripeGateway(secretKey);

    const begin: {
      existingStripeAccountId: string | null;
      organizationName: string;
      contactEmail: string | null;
      country: StripeCountry | null;
    } = await ctx.runMutation(internal.payments.connect.beginStripeOnboarding, {
      organizationId: args.organizationId,
      country: args.country,
    });

    let stripeAccountId = begin.existingStripeAccountId;
    if (!stripeAccountId) {
      if (!begin.contactEmail || !begin.country) {
        // Unreachable: the begin mutation refuses a first-time connect
        // without an email or a supported country. Kept so the gateway
        // contract stays non-optional.
        throw new Error("Stripe onboarding is missing required details");
      }
      const created = await gateway.createRecipientAccount({
        organizationId: args.organizationId,
        displayName: begin.organizationName,
        contactEmail: begin.contactEmail,
        country: begin.country,
      });
      const recorded: { stripeAccountId: string } = await ctx.runMutation(
        internal.payments.connect.recordStripeAccountCreated,
        {
          organizationId: args.organizationId,
          stripeAccountId: created.stripeAccountId,
          country: begin.country,
        },
      );
      stripeAccountId = recorded.stripeAccountId;
    }

    const returnUrl = `${origin}/admin/stripe-return`;
    const { url } = await gateway.createOnboardingLink({
      stripeAccountId,
      returnUrl,
      refreshUrl: `${returnUrl}?refresh=1`,
    });
    return { url };
  },
});

// Mints a single-use login link into the organization's Express Dashboard,
// where the organizer sees their balance, upcoming payouts, and bank account.
// Owner-only like every other connection verb, and only ever handed to the
// authenticated owner in-app (Stripe: never share login links externally).
export const createDashboardLink = action({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const gateway = getStripeGateway(requireStripeSecretKey());
    const begin: { stripeAccountId: string | null } = await ctx.runMutation(
      internal.payments.connect.beginStripeDashboardLink,
      { organizationId: args.organizationId },
    );
    if (!begin.stripeAccountId) {
      throw new Error("Connect a Stripe account first");
    }
    return await gateway.createDashboardLoginLink({
      stripeAccountId: begin.stripeAccountId,
    });
  },
});

// Re-reads the connected account's transfers capability from Stripe and
// stores the snapshot. Fired by the onboarding return route, the card's
// refresh button, and the account event destination (http.ts); the payout
// path re-checks live regardless.
export const refreshAccountStatus = action({
  args: { organizationId: v.id("organizations") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    transfersCapabilityStatus: TransfersCapabilityStatus;
    payoutsReady: boolean;
  }> => {
    const secretKey = requireStripeSecretKey();
    const gateway = getStripeGateway(secretKey);

    const begin: { stripeAccountId: string | null } = await ctx.runMutation(
      internal.payments.connect.beginStripeStatusRefresh,
      { organizationId: args.organizationId },
    );
    if (!begin.stripeAccountId) {
      throw new Error("Connect a Stripe account first");
    }

    const status = await gateway.retrieveTransfersCapabilityStatus({
      stripeAccountId: begin.stripeAccountId,
    });
    await (ctx.runMutation(
      internal.payments.connect.recordStripeAccountStatus,
      {
        organizationId: args.organizationId,
        transfersCapabilityStatus: status,
      },
    ) satisfies Promise<null>);

    return {
      transfersCapabilityStatus: status,
      payoutsReady: status === "active",
    };
  },
});
