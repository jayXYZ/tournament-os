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

export type StripeWebhookEvent = Stripe.Event;

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
  createCheckoutSession(args: {
    orderId: string;
    productName: string;
    totalCents: number;
    transferGroup: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; url: string }>;
  expireCheckoutSession(args: { sessionId: string }): Promise<void>;
  retrievePaymentIntentCharge(args: {
    paymentIntentId: string;
  }): Promise<{ chargeId: string | null }>;
  createRefund(args: {
    chargeId: string;
    amountCents: number;
    // Our paymentRefunds row id, stamped into the refund's metadata so
    // reconciliation can find the row even if the result write was lost.
    refundRowId: string;
    idempotencyKey: string;
  }): Promise<{ stripeRefundId: string }>;
  createTransfer(args: {
    destinationAccountId: string;
    amountCents: number;
    // The paid order's charge: anchors availability to the original payment
    // and shares its transfer group.
    sourceChargeId: string;
    transferGroup: string;
    idempotencyKey: string;
  }): Promise<{ stripeTransferId: string }>;
  constructWebhookEvent(args: {
    payload: string;
    signature: string;
    secret: string;
  }): Promise<StripeWebhookEvent>;
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

    async createCheckoutSession(args) {
      // Separate charges and transfers: the charge lands on the platform
      // account, tagged with the order's transfer group — nothing moves to
      // the connected account at charge time and no application fee is set
      // (fees are transfer math at payout). Payment-method restriction params
      // are deliberately omitted so Stripe picks dynamic payment methods.
      // The structural spec pins all three omissions.
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: args.totalCents,
                product_data: { name: args.productName },
              },
            },
          ],
          payment_intent_data: { transfer_group: args.transferGroup },
          success_url: args.successUrl,
          cancel_url: args.cancelUrl,
          metadata: { orderId: args.orderId },
          client_reference_id: args.orderId,
          integration_identifier: "tournament_os_entry_kqzvwhtd",
        },
        { idempotencyKey: args.idempotencyKey },
      );
      if (!session.url) {
        throw new Error("Stripe did not return a Checkout URL");
      }
      return { sessionId: session.id, url: session.url };
    },

    async expireCheckoutSession(args) {
      await stripe.checkout.sessions.expire(args.sessionId);
    },

    async retrievePaymentIntentCharge(args) {
      const intent = await stripe.paymentIntents.retrieve(args.paymentIntentId);
      const charge = intent.latest_charge;
      return {
        chargeId: typeof charge === "string" ? charge : (charge?.id ?? null),
      };
    },

    async createRefund(args) {
      const refund = await stripe.refunds.create(
        {
          charge: args.chargeId,
          amount: args.amountCents,
          metadata: { refundId: args.refundRowId },
        },
        { idempotencyKey: args.idempotencyKey },
      );
      return { stripeRefundId: refund.id };
    },

    async createTransfer(args) {
      const transfer = await stripe.transfers.create(
        {
          amount: args.amountCents,
          currency: "usd",
          destination: args.destinationAccountId,
          source_transaction: args.sourceChargeId,
          transfer_group: args.transferGroup,
        },
        { idempotencyKey: args.idempotencyKey },
      );
      return { stripeTransferId: transfer.id };
    },

    async constructWebhookEvent(args) {
      // Signature verification via Web Crypto — the default Convex runtime
      // has SubtleCrypto, so the webhook route needs no Node runtime hop.
      return await stripe.webhooks.constructEventAsync(
        args.payload,
        args.signature,
        args.secret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    },
  };
}
