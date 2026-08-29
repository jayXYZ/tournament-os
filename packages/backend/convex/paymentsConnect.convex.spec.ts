/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TransfersCapabilityStatus } from "./stripe/client";

// Behavioral coverage for Stripe Connect onboarding (payments/connect.ts).
// All Stripe I/O goes through the stripe/client gateway and deployment
// configuration through stripe/config, so mocking those two modules makes
// the suite deterministic with no Stripe involvement.

const gatewayState = vi.hoisted(() => ({
  createRecipientAccountCalls: [] as Array<{
    organizationId: string;
    displayName: string;
    contactEmail?: string;
  }>,
  createOnboardingLinkCalls: [] as Array<{
    stripeAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }>,
  retrieveStatusCalls: [] as Array<{ stripeAccountId: string }>,
  nextCapabilityStatus: "pending" as string,
}));

vi.mock("./stripe/config", () => ({
  requireStripeSecretKey: () => "rk_test_fake",
  requireWebAppOrigin: () => "https://app.test",
  isStripeConfigured: () => true,
}));

vi.mock("./stripe/client", () => ({
  getStripeGateway: () => ({
    createRecipientAccount: async (args: {
      organizationId: string;
      displayName: string;
      contactEmail?: string;
    }) => {
      gatewayState.createRecipientAccountCalls.push(args);
      return { stripeAccountId: "acct_test_1" };
    },
    createOnboardingLink: async (args: {
      stripeAccountId: string;
      returnUrl: string;
      refreshUrl: string;
    }) => {
      gatewayState.createOnboardingLinkCalls.push(args);
      return { url: "https://connect.stripe.test/onboarding" };
    },
    retrieveTransfersCapabilityStatus: async (args: {
      stripeAccountId: string;
    }) => {
      gatewayState.retrieveStatusCalls.push(args);
      return gatewayState.nextCapabilityStatus as TransfersCapabilityStatus;
    },
  }),
}));

beforeEach(() => {
  gatewayState.createRecipientAccountCalls = [];
  gatewayState.createOnboardingLinkCalls = [];
  gatewayState.retrieveStatusCalls = [];
  gatewayState.nextCapabilityStatus = "pending";
});

const adminIdentity = {
  issuer: "https://convex.test",
  subject: "org-admin",
  tokenIdentifier: "https://convex.test|org-admin",
  email: "admin@example.test",
  name: "Org Admin",
};

test("owner connects: one account per organization, snapshot row, fresh links", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  const first = await asOwner.action(
    api.payments.connect.createOnboardingLink,
    {
      organizationId,
    },
  );
  expect(first.url).toBe("https://connect.stripe.test/onboarding");

  expect(gatewayState.createRecipientAccountCalls).toHaveLength(1);
  expect(gatewayState.createRecipientAccountCalls[0]).toMatchObject({
    organizationId,
    displayName: "Test Org",
    contactEmail: organizerIdentity.email,
  });
  expect(gatewayState.createOnboardingLinkCalls[0]).toEqual({
    stripeAccountId: "acct_test_1",
    returnUrl: "https://app.test/admin/stripe-return",
    refreshUrl: "https://app.test/admin/stripe-return?refresh=1",
  });

  const settings = await asOwner.query(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId },
  );
  expect(settings.canManage).toBe(true);
  expect(settings.connection).toMatchObject({
    transfersCapabilityStatus: "pending",
    payoutsReady: false,
  });

  // A second link (expired-link re-entry) reuses the recorded account
  // instead of minting another one.
  await asOwner.action(api.payments.connect.createOnboardingLink, {
    organizationId,
  });
  expect(gatewayState.createRecipientAccountCalls).toHaveLength(1);
  expect(gatewayState.createOnboardingLinkCalls).toHaveLength(2);
});

test("refresh snapshots the live transfers capability", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  await asOwner.action(api.payments.connect.createOnboardingLink, {
    organizationId,
  });

  gatewayState.nextCapabilityStatus = "active";
  const refreshed = await asOwner.action(
    api.payments.connect.refreshAccountStatus,
    { organizationId },
  );
  expect(refreshed).toEqual({
    transfersCapabilityStatus: "active",
    payoutsReady: true,
  });
  expect(gatewayState.retrieveStatusCalls).toEqual([
    { stripeAccountId: "acct_test_1" },
  ]);

  const settings = await asOwner.query(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId },
  );
  expect(settings.connection).toMatchObject({
    transfersCapabilityStatus: "active",
    payoutsReady: true,
  });
});

test("refresh before connecting is refused", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  await expect(
    asOwner.action(api.payments.connect.refreshAccountStatus, {
      organizationId,
    }),
  ).rejects.toThrow("Connect a Stripe account first");
});

test("admins can read payment settings but not manage the connection", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);

  await t.run(async (ctx) => {
    const now = Date.now();
    const adminUserId = await ctx.db.insert("users", {
      tokenIdentifier: adminIdentity.tokenIdentifier,
      publicCode: 100,
      email: adminIdentity.email,
      name: adminIdentity.name,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId: adminUserId,
      email: adminIdentity.email,
      role: "admin",
      status: "active",
      updatedAt: now,
    });
  });

  const asAdmin = t.withIdentity(adminIdentity);
  const settings = await asAdmin.query(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId },
  );
  expect(settings.canManage).toBe(false);
  expect(settings.connection).toBeNull();

  await expect(
    asAdmin.action(api.payments.connect.createOnboardingLink, {
      organizationId,
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asAdmin.action(api.payments.connect.refreshAccountStatus, {
      organizationId,
    }),
  ).rejects.toThrow("Unauthorized");
});

test("non-members cannot read payment settings", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: adminIdentity.tokenIdentifier,
      publicCode: 100,
      email: adminIdentity.email,
      name: adminIdentity.name,
      updatedAt: Date.now(),
    });
  });

  const asOutsider = t.withIdentity(adminIdentity);
  await expect(
    asOutsider.query(api.payments.connect.getOrganizationPaymentSettings, {
      organizationId,
    }),
  ).rejects.toThrow("Unauthorized");
});
