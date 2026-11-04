import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerAuthGate } from "./auth-readiness.ts";
import { useJoinCode } from "./join-code.ts";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useViewerAuthGate: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("./auth-readiness", () => ({
  useViewerAuthGate: mocks.useViewerAuthGate,
}));

type Resolved = { publicCode: string; inviteCode?: string } | null;

// The gate is mocked, so the snapshot only carries what the hook reads
// directly: whether the provider is still loading.
function run(scenario: {
  gate: ViewerAuthGate;
  resolved: Resolved | undefined;
  providerLoading?: boolean;
}) {
  mocks.useViewerAuthGate.mockReturnValue(scenario.gate);
  mocks.useQuery.mockReturnValue(scenario.resolved);
  return useJoinCode("7KQ2MX", {
    user: scenario.gate === "signedOut" ? null : { email: "p@example.com" },
    loading: scenario.providerLoading ?? false,
  });
}

beforeEach(() => {
  mocks.useViewerAuthGate.mockReset();
  mocks.useQuery.mockReset();
});

describe("useJoinCode", () => {
  it("loading while the auth provider is still resolving", () => {
    expect(
      run({
        gate: "pending",
        providerLoading: true,
        resolved: { publicCode: "7KQ2MX" },
      }),
    ).toEqual({ state: "loading" });
  });

  it("loading while the lookup is in flight", () => {
    expect(run({ gate: "signedOut", resolved: undefined })).toEqual({
      state: "loading",
    });
  });

  it("loading for a signed-in viewer whose null may be a private event they can open", () => {
    // Convex validating the token, or an unauthenticated verdict still
    // inside the gate's grace period: both read as pending.
    expect(run({ gate: "pending", resolved: null })).toEqual({
      state: "loading",
    });
  });

  it("notFound once a signed-in viewer's Convex auth settles", () => {
    expect(run({ gate: "ready", resolved: null })).toEqual({
      state: "notFound",
    });
  });

  it("notFound for a signed-out viewer", () => {
    expect(run({ gate: "signedOut", resolved: null })).toEqual({
      state: "notFound",
    });
  });

  it("unverified, not notFound, when the gate gave up on a signed-in viewer", () => {
    expect(run({ gate: "unverified", resolved: null })).toEqual({
      state: "unverified",
    });
  });

  it("resolves a public code without waiting on auth", () => {
    expect(
      run({ gate: "pending", resolved: { publicCode: "7KQ2MX" } }),
    ).toEqual({ state: "resolved", publicCode: "7KQ2MX" });
  });

  it("resolves a public code for an unverified viewer too", () => {
    expect(
      run({ gate: "unverified", resolved: { publicCode: "7KQ2MX" } }),
    ).toEqual({ state: "resolved", publicCode: "7KQ2MX" });
  });

  it("carries the invite code through", () => {
    expect(
      run({
        gate: "signedOut",
        resolved: { publicCode: "7KQ2MX", inviteCode: "AB12CD34EF" },
      }),
    ).toEqual({
      state: "resolved",
      publicCode: "7KQ2MX",
      inviteCode: "AB12CD34EF",
    });
  });
});
