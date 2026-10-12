import { ConvexError } from "convex/values";

// A refusal written for the person using the app — capacity, duplicates,
// cutoffs, lifecycle and checkout state, form validation. Production Convex
// deployments redact the message of a plain `Error` to "Server Error" before
// it reaches the client and forward only `ConvexError` data, so anything a
// client should display must travel this way; `mutationErrorMessage` in
// @paper-pairings/core reads the payload back out. The payload is the bare
// string so `error.message` stays the same text in dev and in specs.
//
// Invariant failures, "not found" for ids a client should never hold, and
// authorization refusals ("Unauthorized", "Not authenticated") stay plain
// `Error`: they are not written for users and should remain generic in prod.
export function userError(message: string) {
  return new ConvexError(message);
}
