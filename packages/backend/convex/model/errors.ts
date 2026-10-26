import { ConvexError } from "convex/values";

// A refusal written for the person using the app — capacity, duplicates,
// cutoffs, lifecycle and checkout state, form validation. Production Convex
// deployments redact the message of a plain `Error` to "Server Error" before
// it reaches the client and forward only `ConvexError` data, so anything a
// client should display must travel this way. The payload is the bare string
// so `error.message` stays the same text in dev and in specs.
//
// Only the payload crosses the wire: the client rebuilds every failure as a
// stock `ConvexError`, so `mutationErrorMessage` in @paper-pairings/core (and
// the web router's error component, for refusals thrown by queries) treats
// any string-payload `ConvexError` as a refusal to show verbatim. That is why
// nothing else in this backend may throw a `ConvexError` with a string
// payload; structured payloads (the rate limiter, the pagination handshake)
// are objects. On the server and in specs the class is the marker:
// `instanceof UserError` tells a refusal from any other `ConvexError`.
//
// Invariant failures, "not found" for ids a client should never hold, and
// authorization refusals ("Unauthorized", "Not authenticated") stay plain
// `Error`: they are not written for users and should remain generic in prod.
export class UserError extends ConvexError<string> {}

export function userError(message: string) {
  return new UserError(message);
}
