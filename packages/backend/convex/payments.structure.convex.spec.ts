// @vitest-environment node
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

// Pins the Stripe Connect invariants that reviews would otherwise have to
// re-derive: v2-only account calls, the marketplace responsibility settings,
// recipient-only capabilities, and configuration through the generated env.

const clientSource = readFileSync(
  new URL("./stripe/client.ts", import.meta.url),
  "utf8",
);
const configSource = readFileSync(
  new URL("./stripe/config.ts", import.meta.url),
  "utf8",
);
const connectSource = readFileSync(
  new URL("./payments/connect.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("./schema.ts", import.meta.url),
  "utf8",
);

test("connected accounts use the v2 Accounts API, never legacy account types", () => {
  expect(clientSource).toMatch(/stripe\.v2\.core\.accounts\.create/);
  expect(clientSource).toMatch(/stripe\.v2\.core\.accountLinks\.create/);
  expect(clientSource).not.toMatch(/type:\s*["'](express|standard|custom)["']/);
});

test("accounts are express-dashboard recipients with platform-owned fees and losses", () => {
  expect(clientSource).toMatch(/dashboard: "express"/);
  expect(clientSource).toMatch(/fees_collector: "application"/);
  expect(clientSource).toMatch(/losses_collector: "application"/);
  expect(clientSource).toMatch(/stripe_transfers: \{ requested: true \}/);
  // Recipient-only: requesting merchant/card_payments would lengthen
  // onboarding for a capability the separate-charges flow never uses.
  expect(clientSource).not.toMatch(/card_payments/);
  expect(clientSource).not.toMatch(/merchant/);
});

test("stripe configuration reads the generated env, never process.env", () => {
  expect(configSource).toMatch(/from "\.\.\/_generated\/server"/);
  expect(configSource).not.toMatch(/process\.env/);
  expect(clientSource).not.toMatch(/process\.env/);
  expect(connectSource).not.toMatch(/process\.env/);
});

test("connect endpoints are permission-gated, rate-limited, and index-only", () => {
  expect(connectSource).toMatch(/requirePaymentsPermission/);
  expect(connectSource).toMatch(/enforceRateLimit\(ctx, "stripeOnboarding"\)/);
  expect(connectSource).toMatch(
    /enforceRateLimit\(ctx, "refreshStripeStatus"\)/,
  );
  expect(connectSource).not.toMatch(/\.filter\(/);
});

test("organization stripe accounts are indexed for both lookup directions", () => {
  expect(schemaSource).toMatch(
    /organizationStripeAccounts: defineTable\([\s\S]*?\.index\("by_organizationId", \["organizationId"\]\)[\s\S]*?\.index\("by_stripeAccountId", \["stripeAccountId"\]\)/,
  );
});

const httpSource = readFileSync(new URL("./http.ts", import.meta.url), "utf8");
const webhooksSource = readFileSync(
  new URL("./payments/webhooks.ts", import.meta.url),
  "utf8",
);
const registrationsSource = readFileSync(
  new URL("./tournaments/registrations.ts", import.meta.url),
  "utf8",
);

test("the webhook route verifies signatures before any state change", () => {
  expect(httpSource).toMatch(/stripe-signature/);
  expect(httpSource).toMatch(/constructWebhookEvent/);
  expect(httpSource).toMatch(/status: 400/);
});

test("webhook mutations never call Stripe themselves", () => {
  expect(webhooksSource).not.toMatch(/getStripeGateway/);
  expect(webhooksSource).not.toMatch(/from "stripe"/);
  expect(webhooksSource).not.toMatch(/\.filter\(/);
});

test("checkout sessions follow the separate-charges shape", () => {
  // No transfer at charge time, no application fee (incompatible with
  // separate charges and transfers), and no payment_method_types (dynamic
  // payment methods stay enabled).
  expect(clientSource).toMatch(/transfer_group/);
  expect(clientSource).not.toMatch(/transfer_data/);
  expect(clientSource).not.toMatch(/application_fee_amount/);
  expect(clientSource).not.toMatch(/payment_method_types/);
});

test("registerSelf routes direct paid registration to checkout", () => {
  expect(registrationsSource).toMatch(/isPaidTournament\(tournament\)/);
  expect(registrationsSource).toMatch(/register through the payment checkout/);
});
