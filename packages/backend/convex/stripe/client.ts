import Stripe from "stripe";

// Every Stripe API call funnels through this gateway so behavioral specs can
// mock one module and the rest of the payments code never touches the SDK.
// It runs in Convex's default runtime — the fetch HTTP client replaces
// stripe-node's Node transport and webhook verification uses the
// SubtleCrypto provider — so no payments file needs "use node".
//
// Connect architecture (see the stripe-payments plan): organizations get
// recipient-configured v2 connected accounts (express dashboard, platform
// owns fees and losses) and are paid by separate charges and transfers, so
// no account here ever accepts payments itself.

export const STRIPE_API_VERSION = "2026-07-29.dahlia";

export type TransfersCapabilityStatus =
  | "pending"
  | "active"
  | "restricted"
  | "unsupported";

export interface StripeGateway {
  createRecipientAccount(args: {
    organizationId: string;
    displayName: string;
    contactEmail?: string;
  }): Promise<{ stripeAccountId: string }>;
  createOnboardingLink(args: {
    stripeAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  retrieveTransfersCapabilityStatus(args: {
    stripeAccountId: string;
  }): Promise<TransfersCapabilityStatus>;
}

export function getStripeGateway(secretKey: string): StripeGateway {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });

  return {
    async createRecipientAccount(args) {
      // Recipient-only configuration: the account receives transfers from
      // the platform and never takes payments itself, so requesting
      // payment-acceptance capabilities would only lengthen onboarding.
      const account = await stripe.v2.core.accounts.create(
        {
          display_name: args.displayName,
          contact_email: args.contactEmail,
          dashboard: "express",
          defaults: {
            responsibilities: {
              fees_collector: "application",
              losses_collector: "application",
            },
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
          metadata: { organizationId: args.organizationId },
        },
        // One logical account per organization: a concurrent double-click
        // replays as the same Stripe request instead of minting two accounts.
        { idempotencyKey: `acct:${args.organizationId}` },
      );
      return { stripeAccountId: account.id };
    },

    async createOnboardingLink(args) {
      const link = await stripe.v2.core.accountLinks.create({
        account: args.stripeAccountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["recipient"],
            // Collect everything up front so the organizer finishes
            // onboarding in one pass instead of being pulled back for more
            // information after their first payout.
            collection_options: { fields: "eventually_due" },
            return_url: args.returnUrl,
            refresh_url: args.refreshUrl,
          },
        },
      });
      return { url: link.url };
    },

    async retrieveTransfersCapabilityStatus(args) {
      // v2 retrieves return null for configuration unless explicitly included.
      const account = await stripe.v2.core.accounts.retrieve(
        args.stripeAccountId,
        { include: ["configuration.recipient"] },
      );
      return (
        account.configuration?.recipient?.capabilities?.stripe_balance
          ?.stripe_transfers?.status ?? "pending"
      );
    },
  };
}
