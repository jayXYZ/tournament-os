import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action, internalMutation, query } from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import {
  requirePaymentsPermission,
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
  args: { organizationId: v.id("organizations") },
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

    return {
      existingStripeAccountId: existing?.stripeAccountId ?? null,
      organizationName: organization.name,
      contactEmail: user.email ?? null,
    };
  },
});

export const recordStripeAccountCreated = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    stripeAccountId: v.string(),
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

    const now = Date.now();
    await ctx.db.patch(account._id, {
      transfersCapabilityStatus: args.transfersCapabilityStatus,
      payoutsReady: args.transfersCapabilityStatus === "active",
      lastSyncedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

// Mints a Stripe-hosted onboarding link for the organization's connected
// account, creating the account first if this is the organization's first
// visit. The same action serves "connect", "continue onboarding", and the
// refresh_url re-entry (Stripe links are single-use and short-lived).
export const createOnboardingLink = action({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const secretKey = requireStripeSecretKey();
    const origin = requireWebAppOrigin();
    const gateway = getStripeGateway(secretKey);

    const begin: {
      existingStripeAccountId: string | null;
      organizationName: string;
      contactEmail: string | null;
    } = await ctx.runMutation(internal.payments.connect.beginStripeOnboarding, {
      organizationId: args.organizationId,
    });

    let stripeAccountId = begin.existingStripeAccountId;
    if (!stripeAccountId) {
      const created = await gateway.createRecipientAccount({
        organizationId: args.organizationId,
        displayName: begin.organizationName,
        contactEmail: begin.contactEmail ?? undefined,
      });
      const recorded: { stripeAccountId: string } = await ctx.runMutation(
        internal.payments.connect.recordStripeAccountCreated,
        {
          organizationId: args.organizationId,
          stripeAccountId: created.stripeAccountId,
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

// Re-reads the connected account's transfers capability from Stripe and
// stores the snapshot. Fired by the onboarding return route and the card's
// refresh button; the payout path re-checks live regardless.
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
    await ctx.runMutation(internal.payments.connect.recordStripeAccountStatus, {
      organizationId: args.organizationId,
      transfersCapabilityStatus: status,
    });

    return {
      transfersCapabilityStatus: status,
      payoutsReady: status === "active",
    };
  },
});
