import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConvexAuthReadiness } from "./auth-readiness.ts";
import { useJoinCode } from "./join-code.ts";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useConvexAuthReadiness: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("./auth-readiness", () => ({
  useConvexAuthReadiness: mocks.useConvexAuthReadiness,
}));

type Resolved = { publicCode: string; inviteCode?: string } | null;

function run(scenario: {
  provider: "loading" | "signedOut" | "signedIn";
  convex: ConvexAuthReadiness;
  resolved: Resolved | undefined;
}) {
  mocks.useConvexAuthReadiness.mockReturnValue(scenario.convex);
  mocks.useQuery.mockReturnValue(scenario.resolved);
  return useJoinCode("7KQ2MX", {
    user: scenario.provider === "signedIn" ? { email: "p@example.com" } : null,
    loading: scenario.provider === "loading",
  });
}

beforeEach(() => {
  mocks.useConvexAuthReadiness.mockReset();
  mocks.useQuery.mockReset();
});

describe("useJoinCode", () => {
  it("loading while the auth provider is still resolving", () => {
    expect(
      run({
        provider: "loading",
        convex: "pending",
        resolved: { publicCode: "7KQ2MX" },
      }),
    ).toEqual({ state: "loading" });
  });

  it("loading while the lookup is in flight", () => {
    expect(
      run({
        provider: "signedOut",
        convex: "unauthenticated",
        resolved: undefined,
      }),
    ).toEqual({ state: "loading" });
  });

  it("loading for a signed-in viewer whose null may be a private event they can open", () => {
    expect(
      run({ provider: "signedIn", convex: "pending", resolved: null }),
    ).toEqual({ state: "loading" });
  });

  it("notFound once a signed-in viewer's Convex auth settles", () => {
    expect(
      run({ provider: "signedIn", convex: "ready", resolved: null }),
    ).toEqual({ state: "notFound" });
  });

  it("notFound for a signed-out viewer", () => {
    expect(
      run({ provider: "signedOut", convex: "unauthenticated", resolved: null }),
    ).toEqual({ state: "notFound" });
  });

  it("resolves a public code without waiting on auth", () => {
    expect(
      run({
        provider: "signedIn",
        convex: "pending",
        resolved: { publicCode: "7KQ2MX" },
      }),
    ).toEqual({ state: "resolved", publicCode: "7KQ2MX" });
  });

  it("carries the invite code through", () => {
    expect(
      run({
        provider: "signedOut",
        convex: "unauthenticated",
        resolved: { publicCode: "7KQ2MX", inviteCode: "AB12CD34EF" },
      }),
    ).toEqual({
      state: "resolved",
      publicCode: "7KQ2MX",
      inviteCode: "AB12CD34EF",
    });
  });
});
