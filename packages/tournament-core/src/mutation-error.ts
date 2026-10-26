import { ConvexError } from "convex/values";

// The payload @convex-dev/rate-limiter throws when a bucket in the backend's
// convex/rateLimits.ts empties; its own isRateLimitError checks this exact
// shape. The check is reimplemented here instead of imported so ConvexError
// resolves through this package's convex peer — the same copy that
// constructed the caught error in each app — rather than a second instance
// pnpm may give the component package, which would make instanceof silently
// fail and let the raw error text through.
type RateLimitErrorData = {
  kind: "RateLimited";
  name: string;
  // Milliseconds from now until a retry can succeed.
  retryAfter: number;
};

function rateLimitData(error: unknown): RateLimitErrorData | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const data: unknown = error.data;
  if (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: unknown }).kind === "RateLimited" &&
    typeof (data as { retryAfter?: unknown }).retryAfter === "number"
  ) {
    return data as RateLimitErrorData;
  }
  return null;
}

function describeRetryDelay(retryAfterMs: number) {
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (seconds < 5) {
    return "a few seconds";
  }
  if (seconds < 60) {
    return `about ${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
  }
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

// The refusal the backend's model/errors.ts userError threw, if `error` is
// one: a bare string written for the person using the app. Production Convex
// deployments redact a plain Error's message to "Server Error" and forward
// only ConvexError data, so the text is read from `data` rather than
// `message`. An empty payload is no message at all and yields null so the
// caller's fallback applies.
export function userErrorMessage(error: unknown): string | null {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data.length > 0 ? error.data : null;
  }
  return null;
}

// Every failure the Convex client rebuilds from a server response carries a
// message of this shape ("[CONVEX M(path)] [Request ID: …] Server Error" in
// production; the server stack in dev). It is transport text, never written
// for a user — any refusal meant for one arrives as ConvexError data instead,
// so a plain Error with this prefix is the backend saying "not for you".
// Errors thrown on the client itself — form validation ahead of the call —
// have no such prefix and keep their own message.
const CONVEX_SERVER_FAILURE_PREFIX = "[CONVEX ";

function isServerFailure(error: Error) {
  return error.message.startsWith(CONVEX_SERVER_FAILURE_PREFIX);
}

// Message for a rejected mutation, shared by the web and native clients so a
// throttled request never surfaces as a raw ConvexError. Rate-limited
// rejections become a retry-later notice sized from the server's retryAfter;
// a user-facing refusal shows its own text; any other server failure, and
// any ConvexError with a structured payload, is `fallback` — the message
// there is redacted or internal either way. Only an Error thrown on the
// client keeps its own message.
export function mutationErrorMessage(error: unknown, fallback: string) {
  const rateLimit = rateLimitData(error);
  if (rateLimit) {
    return `You're doing that too often — try again in ${describeRetryDelay(
      rateLimit.retryAfter,
    )}.`;
  }
  const userMessage = userErrorMessage(error);
  if (userMessage !== null) {
    return userMessage;
  }
  if (error instanceof ConvexError) {
    return fallback;
  }
  if (error instanceof Error && !isServerFailure(error)) {
    return error.message;
  }
  return fallback;
}
