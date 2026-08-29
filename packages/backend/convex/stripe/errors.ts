import Stripe from "stripe";

// Failure classification for Stripe calls, kept out of client.ts so specs
// that mock the gateway module never have to stub it.

// Whether a thrown Stripe call provably created nothing: a 4xx-class
// rejection (invalid request, card declined, auth, permission, rate limit)
// means the request was received and refused, so the attempt may be settled
// as failed. A connection drop or a Stripe 5xx leaves the outcome unknown —
// the object may exist on Stripe's side — so callers must NOT settle on
// those; they keep the row pending and reconcile by retrying under the same
// idempotency key or letting the webhook report the truth.
export function isDefinitiveStripeFailure(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeError &&
    error.type !== "StripeConnectionError" &&
    error.type !== "StripeAPIError"
  );
}
