/// <reference types="vite/client" />
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
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
    country: string;
  }>,
  createOnboardingLinkCalls: [] as Array<{
    stripeAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }>,
  retrieveStatusCalls: [] as Array<{ stripeAccountId: string }>,
  dashboardLinkCalls: [] as Array<{ stripeAccountId: string }>,
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
      country: string;
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
    createDashboardLoginLink: async (args: { stripeAccountId: string }) => {
      gatewayState.dashboardLinkCalls.push(args);
      return { url: "https://connect.stripe.test/express-login" };
    },
  }),
}));

beforeEach(() => {
  gatewayState.createRecipientAccountCalls = [];
  gatewayState.createOnboardingLinkCalls = [];
  gatewayState.retrieveStatusCalls = [];
  gatewayState.dashboardLinkCalls = [];
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
      country: "us",
    },
  );
  expect(first.url).toBe("https://connect.stripe.test/onboarding");

  expect(gatewayState.createRecipientAccountCalls).toHaveLength(1);
  expect(gatewayState.createRecipientAccountCalls[0]).toMatchObject({
    organizationId,
    displayName: "Test Org",
    contactEmail: organizerIdentity.email,
    country: "us",
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
    country: "us",
    transfersCapabilityStatus: "pending",
    payoutsReady: false,
  });

  // A second link (expired-link re-entry) reuses the recorded account
  // instead of minting another one; the country is only read on a
  // first connect, so the re-entry need not repeat it.
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
    country: "us",
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

test("account events overwrite the snapshot by connected account id", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  await asOwner.action(api.payments.connect.createOnboardingLink, {
    organizationId,
    country: "us",
  });

  // The thin-event route (http.ts) re-reads the live capability and lands
  // here with the account id Stripe named — no organization in the payload.
  const recorded = await t.mutation(
    internal.payments.connect.recordStripeAccountStatusByAccountId,
    { stripeAccountId: "acct_test_1", transfersCapabilityStatus: "active" },
  );
  expect(recorded).toBe(true);

  const settings = await asOwner.query(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId },
  );
  expect(settings.connection).toMatchObject({
    transfersCapabilityStatus: "active",
    payoutsReady: true,
  });

  // An account this deployment never recorded is ignored, not an error, so
  // Stripe does not retry the delivery.
  const ignored = await t.mutation(
    internal.payments.connect.recordStripeAccountStatusByAccountId,
    {
      stripeAccountId: "acct_unknown",
      transfersCapabilityStatus: "restricted",
    },
  );
  expect(ignored).toBe(false);
});

test("the owner opens the Express dashboard through a fresh login link", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  await expect(
    asOwner.action(api.payments.connect.createDashboardLink, {
      organizationId,
    }),
  ).rejects.toThrow("Connect a Stripe account first");

  await asOwner.action(api.payments.connect.createOnboardingLink, {
    organizationId,
    country: "us",
  });
  const link = await asOwner.action(api.payments.connect.createDashboardLink, {
    organizationId,
  });
  expect(link.url).toBe("https://connect.stripe.test/express-login");
  expect(gatewayState.dashboardLinkCalls).toEqual([
    { stripeAccountId: "acct_test_1" },
  ]);
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
      country: "us",
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asAdmin.action(api.payments.connect.refreshAccountStatus, {
      organizationId,
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asAdmin.action(api.payments.connect.createDashboardLink, {
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

test("a first connect outside the supported countries never reaches Stripe", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const asOwner = t.withIdentity(organizerIdentity);

  // The account's country is fixed at creation and the platform is USD-only,
  // so an unsupported country is refused before any account is minted —
  // otherwise the organization would own a connected account that can never
  // finish onboarding.
  await expect(
    asOwner.action(api.payments.connect.createOnboardingLink, {
      organizationId,
      country: "gb",
    }),
  ).rejects.toThrow("United States only");

  // Omitting the country on a first connect is refused the same way: the UI
  // must collect an explicit acknowledgement.
  await expect(
    asOwner.action(api.payments.connect.createOnboardingLink, {
      organizationId,
    }),
  ).rejects.toThrow("Confirm the organization's country");

  expect(gatewayState.createRecipientAccountCalls).toHaveLength(0);
  expect(gatewayState.createOnboardingLinkCalls).toHaveLength(0);
  const settings = await asOwner.query(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId },
  );
  expect(settings.connection).toBeNull();

  // Country codes are case-insensitive on the way in and stored lowercase,
  // as Accounts v2 identity.country takes them.
  await asOwner.action(api.payments.connect.createOnboardingLink, {
    organizationId,
    country: "US",
  });
  expect(gatewayState.createRecipientAccountCalls[0]).toMatchObject({
    country: "us",
  });
});
