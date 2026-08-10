import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { mutationErrorMessage } from "./mutation-error";

function rateLimited(retryAfter: number) {
  return new ConvexError({
    kind: "RateLimited",
    name: "registerSelf",
    retryAfter,
  });
}

describe("mutationErrorMessage", () => {
  it("turns a rate-limited rejection into a retry-later message", () => {
    expect(mutationErrorMessage(rateLimited(30_000), "fallback")).toBe(
      "You're doing that too often — try again in about 30 seconds.",
    );
  });

  it("sizes the delay wording from retryAfter", () => {
    const cases: Array<[number, string]> = [
      [1_200, "a few seconds"],
      [4_000, "a few seconds"],
      [59_000, "about 59 seconds"],
      [60_000, "about a minute"],
      [90_000, "about 2 minutes"],
      [59 * 60_000, "about 59 minutes"],
      [60 * 60_000, "about an hour"],
      [5 * 60 * 60_000, "about 5 hours"],
    ];
    for (const [retryAfter, delay] of cases) {
      expect(mutationErrorMessage(rateLimited(retryAfter), "fallback")).toBe(
        `You're doing that too often — try again in ${delay}.`,
      );
    }
  });

  it("keeps the message of ordinary errors", () => {
    expect(mutationErrorMessage(new Error("Tournament is full."), "fb")).toBe(
      "Tournament is full.",
    );
  });

  it("does not treat other ConvexError payloads as rate limits", () => {
    const error = new ConvexError("Registration is closed.");
    expect(mutationErrorMessage(error, "fb")).toBe(error.message);
  });

  it("falls back for non-Error throws", () => {
    expect(mutationErrorMessage("boom", "Could not save.")).toBe(
      "Could not save.",
    );
    expect(mutationErrorMessage(undefined, "Could not save.")).toBe(
      "Could not save.",
    );
  });
});
