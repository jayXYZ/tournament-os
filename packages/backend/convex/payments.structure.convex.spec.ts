// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";

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

test("the account event route verifies thin-event signatures and re-reads live status", () => {
  // Capability transitions arrive as v2 thin events on their own destination
  // (own signing secret); the route trusts no payload snapshot and reads the
  // live capability before overwriting ours.
  expect(httpSource).toMatch(/path: "\/stripe\/account-events"/);
  expect(httpSource).toMatch(/constructAccountEventNotification/);
  expect(httpSource).toMatch(/requireStripeAccountWebhookSecret/);
  expect(httpSource).toMatch(/retrieveTransfersCapabilityStatus/);
  expect(clientSource).toMatch(/parseEventNotificationAsync/);
});

test("express-dashboard accounts get login links, never shared credentials", () => {
  expect(clientSource).toMatch(/accounts\.createLoginLink/);
  expect(connectSource).toMatch(
    /enforceRateLimit\(ctx, "stripeDashboardLink"\)/,
  );
});

test("the pinned API version is the installed SDK's latest", () => {
  // `satisfies Stripe.LatestApiVersion` makes tsc the enforcer; this pins
  // that the guard stays in place.
  expect(clientSource).toMatch(
    /STRIPE_API_VERSION =\s*"[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z]+" satisfies Stripe\.LatestApiVersion/,
  );
});

test("no Stripe API keys are committed in source", () => {
  // Key exposure in repositories is the leading cause of Stripe key
  // takeovers. Specs use obviously fake short stand-ins ("rk_test_fake").
  const roots = [
    new URL("./", import.meta.url),
    new URL("../../../apps/web/src/", import.meta.url),
    new URL("../../../packages/shared/src/", import.meta.url),
  ];
  const keyPattern = /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/;
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "_generated") {
        continue;
      }
      const child = new URL(
        entry.isDirectory() ? `${entry.name}/` : entry.name,
        dir,
      );
      if (entry.isDirectory()) {
        walk(child);
      } else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry.name)) {
        if (keyPattern.test(readFileSync(child, "utf8"))) {
          offenders.push(child.pathname);
        }
      }
    }
  };
  for (const root of roots) {
    walk(root);
  }
  expect(offenders).toEqual([]);
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
  expect(registrationsSource).toMatch(/isPaidEvent\(tournament\)/);
  expect(registrationsSource).toMatch(/register through the payment checkout/);
});

test("self-serve child-event entry points enforce the badge gate", () => {
  const checkoutSource = readFileSync(
    new URL("./payments/checkout.ts", import.meta.url),
    "utf8",
  );
  expect(registrationsSource).toMatch(/resolveChildEventAdmission/);
  expect(checkoutSource).toMatch(/resolveChildEventAdmission/);
});

const progressionSource = readFileSync(
  new URL("./model/progression.ts", import.meta.url),
  "utf8",
);
const payoutsSource = readFileSync(
  new URL("./payments/payouts.ts", import.meta.url),
  "utf8",
);

test("completing a paid tournament schedules the payout sweep", () => {
  expect(progressionSource).toMatch(
    /internal\.payments\.payouts\.startPayoutSweep/,
  );
});

test("payout transfers are idempotent and re-check the live capability", () => {
  expect(payoutsSource).toMatch(/idempotencyKey: `transfer:\$\{/);
  expect(payoutsSource).toMatch(/retrieveTransfersCapabilityStatus/);
  expect(payoutsSource).toMatch(/source_transaction|sourceChargeId/);
  // No db-query .filter( — array filters over already-bounded reads are fine.
  expect(payoutsSource).not.toMatch(/\)\s*\n?\s*\.filter\(/);
});
