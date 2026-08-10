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

// Message for a rejected mutation, shared by the web and native clients so a
// throttled request never surfaces as a raw ConvexError. Rate-limited
// rejections become a retry-later notice sized from the server's retryAfter;
// anything else keeps the error's own message, with `fallback` covering
// non-Error throws.
export function mutationErrorMessage(error: unknown, fallback: string) {
  const rateLimit = rateLimitData(error);
  if (rateLimit) {
    return `You're doing that too often — try again in ${describeRetryDelay(
      rateLimit.retryAfter,
    )}.`;
  }
  return error instanceof Error ? error.message : fallback;
}
