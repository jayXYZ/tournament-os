import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { getStripeGateway } from "./stripe/client";
import {
  requireStripeSecretKey,
  requireStripeWebhookSecret,
} from "./stripe/config";

const http = httpRouter();

// Stripe webhook endpoint (served on the deployment's .convex.site domain).
// Fulfillment happens ONLY here — success pages just watch the order — so
// every payment outcome lands exactly once, however the player's browser
// behaved. The signature is verified before anything else; a handler throw
// becomes a 500 so Stripe retries, which the processed-event table makes
// safe.
http.route({
  path: "/stripe/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing signature", { status: 400 });
    }
    const payload = await request.text();
    const gateway = getStripeGateway(requireStripeSecretKey());

    let event;
    try {
      event = await gateway.constructWebhookEvent({
        payload,
        signature,
        secret: requireStripeWebhookSecret(),
      });
    } catch {
      return new Response("Invalid signature", { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        // Delayed-notification methods complete the session while unpaid;
        // the async_payment_succeeded/failed event that follows settles it.
        if (session.payment_status === "unpaid") {
          break;
        }
        const orderId = session.metadata?.orderId;
        if (!orderId) {
          break;
        }
        const stripePaymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
        // The one Stripe read fulfillment needs: the charge that will anchor
        // refunds and the payout transfer.
        const stripeChargeId = stripePaymentIntentId
          ? (
              await gateway.retrievePaymentIntentCharge({
                paymentIntentId: stripePaymentIntentId,
              })
            ).chargeId
          : null;
        await ctx.runMutation(
          internal.payments.webhooks.handleCheckoutCompleted,
          {
            stripeEventId: event.id,
            orderId,
            sessionId: session.id,
            stripePaymentIntentId,
            stripeChargeId,
          },
        );
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId) {
          break;
        }
        await ctx.runMutation(
          internal.payments.webhooks.handleCheckoutExpired,
          {
            stripeEventId: event.id,
            orderId,
            sessionId: session.id,
          },
        );
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object;
        const orderId = session.metadata?.orderId;
        if (!orderId) {
          break;
        }
        await ctx.runMutation(
          internal.payments.webhooks.handleAsyncPaymentFailed,
          {
            stripeEventId: event.id,
            orderId,
            sessionId: session.id,
          },
        );
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object;
        const chargeId =
          typeof dispute.charge === "string"
            ? dispute.charge
            : dispute.charge.id;
        await ctx.runMutation(internal.payments.webhooks.handleDisputeCreated, {
          stripeEventId: event.id,
          stripeChargeId: chargeId,
        });
        break;
      }
      case "refund.updated":
      case "refund.failed": {
        // Reconciliation backstop for the refund executor (see
        // payments/refunds.ts): recovers a result write the executor lost.
        const refund = event.data.object;
        await ctx.runMutation(internal.payments.refunds.handleRefundEvent, {
          stripeEventId: event.id,
          stripeRefundId: refund.id,
          refundStatus: refund.status ?? "unknown",
          refundRowId: refund.metadata?.refundId ?? null,
        });
        break;
      }
      default:
        // Unsubscribed event types are acknowledged, not errors.
        break;
    }

    return new Response(null, { status: 200 });
  }),
});

export default http;
