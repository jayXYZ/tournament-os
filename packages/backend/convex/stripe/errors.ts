import Stripe from "stripe";

// Failure classification for Stripe calls, kept out of client.ts so specs
// that mock the gateway module never have to stub it.

// The Stripe error types a caller may settle a row on: the request reached
// Stripe, was refused for a reason a retry will not change (malformed or
// impossible request, card refusal, idempotency-key misuse), and created
// nothing. An allowlist, because the cost of the two mistakes is lopsided:
// retrying a rejection wastes a call, settling on a transient refusal
// strands a player's money with no re-drive.
const DEFINITIVE_STRIPE_ERROR_TYPES: ReadonlySet<string> = new Set([
  "StripeInvalidRequestError",
  "StripeCardError",
  "StripeIdempotencyError",
]);

// Whether a thrown Stripe call is a definitive rejection. Everything else
// retries: a connection drop or a Stripe 5xx leaves the outcome unknown (the
// object may exist on Stripe's side), and a rate limit, an authentication
// error (a key mid-rotation) or a permission error created nothing but will
// pass once the condition clears. Callers keep the row pending for those
// and reconcile by retrying under the same idempotency key or letting the
// webhook report the truth.
export function isDefinitiveStripeFailure(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeError &&
    DEFINITIVE_STRIPE_ERROR_TYPES.has(error.type)
  );
}

// The text a failed Stripe call leaves on its row (lastError): the error's
// message, or a placeholder for a non-Error throw. One rule for every
// executor so the rows read alike.
export function errorMessageOf(error: unknown) {
  return error instanceof Error ? error.message : "Unknown";
}
