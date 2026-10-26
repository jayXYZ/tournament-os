import { ConvexError, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import { mutationErrorMessage, userErrorMessage } from "./mutation-error";

function rateLimited(retryAfter: number) {
  return new ConvexError({
    kind: "RateLimited",
    name: "registerSelf",
    retryAfter,
  });
}

// What the Convex client throws for a server-side failure: the message is
// its own transport text (see convex's createHybridErrorStacktrace), and a
// ConvexError's `data` is forwarded separately.
const SERVER_FAILURE_MESSAGE =
  "[CONVEX M(tournaments/registrations:dropRegistration)] [Request ID: 7f3a2c] Server Error\n  Called by client";

function serverRefusal(data: Value) {
  const error: ConvexError<Value> = new ConvexError(SERVER_FAILURE_MESSAGE);
  error.data = data;
  return error;
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

  it("reads a user-facing refusal from the ConvexError payload", () => {
    // Production deployments redact `message` and forward only `data`, so
    // the payload is the source of truth.
    expect(
      mutationErrorMessage(serverRefusal("Registration is closed."), "fb"),
    ).toBe("Registration is closed.");
  });

  it("hides a plain server failure behind the fallback", () => {
    // A plain Error on the server ("Unauthorized", "Match not found", an
    // invariant) reaches the client as transport text in prod and as a
    // server stack in dev; neither is written for the user.
    expect(
      mutationErrorMessage(
        new Error(SERVER_FAILURE_MESSAGE),
        "Could not drop player.",
      ),
    ).toBe("Could not drop player.");
    expect(
      mutationErrorMessage(
        new Error(
          "[CONVEX M(tournaments/player:dropSelf)] [Request ID: 1b2c] Uncaught Error: Match not found\n    at handler (../convex/tournaments/player.ts:80:11)\n  Called by client",
        ),
        "Could not drop.",
      ),
    ).toBe("Could not drop.");
  });

  it("keeps the message of an error thrown on the client", () => {
    // Form validation ahead of the mutation call throws plain Errors whose
    // text is for the user (e.g. "Enter valid start and end dates.").
    expect(
      mutationErrorMessage(new Error("Enter valid start and end dates."), "fb"),
    ).toBe("Enter valid start and end dates.");
  });

  it("falls back for structured ConvexError payloads that are not rate limits", () => {
    expect(mutationErrorMessage(serverRefusal({ code: "Other" }), "fb")).toBe(
      "fb",
    );
    expect(mutationErrorMessage(new ConvexError({ code: "Other" }), "fb")).toBe(
      "fb",
    );
  });

  it("falls back for an empty refusal", () => {
    expect(mutationErrorMessage(serverRefusal(""), "Could not save.")).toBe(
      "Could not save.",
    );
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

describe("userErrorMessage", () => {
  it("returns the string payload of a refusal and nothing else", () => {
    expect(userErrorMessage(serverRefusal("Not registered"))).toBe(
      "Not registered",
    );
    expect(userErrorMessage(serverRefusal(""))).toBeNull();
    expect(userErrorMessage(serverRefusal({ code: "Other" }))).toBeNull();
    expect(userErrorMessage(new Error("Not registered"))).toBeNull();
    expect(userErrorMessage(undefined)).toBeNull();
  });
});
