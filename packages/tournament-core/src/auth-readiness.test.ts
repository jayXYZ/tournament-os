import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("convex/react", () => mocks);

import { useAuthedQueryArgs, useConvexAuthReadiness } from "./auth-readiness";
import { useMyDecklist, useMyRegistration, useMyTournaments } from "./hooks";

// What useConvexAuth reports in each token-lag state. Clerk-loading and
// Clerk-signed-in-with-Convex-still-validating are indistinguishable to
// consumers — both must read as "no trustworthy answer yet", never as signed
// out or as data.
const authStates = {
  clerkLoading: { isLoading: true, isAuthenticated: false },
  clerkSignedOut: { isLoading: false, isAuthenticated: false },
  clerkSignedInConvexPending: { isLoading: true, isAuthenticated: false },
  bothReady: { isLoading: false, isAuthenticated: true },
} as const;

const tournamentId = "t1" as Id<"tournaments">;

beforeEach(() => {
  mocks.useConvexAuth.mockReset();
  mocks.useQuery.mockReset().mockReturnValue(undefined);
});

describe("useConvexAuthReadiness", () => {
  it.each([
    ["clerkLoading", "pending"],
    ["clerkSignedOut", "unauthenticated"],
    ["clerkSignedInConvexPending", "pending"],
    ["bothReady", "ready"],
  ] as const)("%s → %s", (state, readiness) => {
    mocks.useConvexAuth.mockReturnValue(authStates[state]);
    expect(useConvexAuthReadiness()).toBe(readiness);
  });
});

describe("useAuthedQueryArgs", () => {
  it.each([
    ["clerkLoading"],
    ["clerkSignedOut"],
    ["clerkSignedInConvexPending"],
  ] as const)("returns 'skip' while %s", (state) => {
    mocks.useConvexAuth.mockReturnValue(authStates[state]);
    expect(useAuthedQueryArgs({ tournamentId })).toBe("skip");
  });

  it("passes args through once Clerk and Convex are both ready", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    expect(useAuthedQueryArgs({ tournamentId })).toEqual({ tournamentId });
  });

  it("still skips when the caller's own preconditions are unmet", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    expect(useAuthedQueryArgs(null)).toBe("skip");
  });
});

// The hooks are thin adapters over useQuery; what matters is which args they
// hand it — 'skip' keeps the result `undefined` (loading), so a skipped
// identity query can never be misread as "not registered" / "no data".
function lastQueryCall() {
  const call = mocks.useQuery.mock.calls.at(-1);
  if (!call) throw new Error("useQuery was not called");
  return { name: getFunctionName(call[0]), args: call[1] };
}

describe("identity query hooks", () => {
  it("useMyRegistration stays loading through the token-lag window", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.clerkSignedInConvexPending);
    expect(useMyRegistration(tournamentId)).toBeUndefined();
    expect(lastQueryCall()).toEqual({
      name: "tournaments/registrations:getMyRegistration",
      args: "skip",
    });
  });

  it("useMyRegistration subscribes once auth is ready", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    useMyRegistration(tournamentId);
    expect(lastQueryCall()).toEqual({
      name: "tournaments/registrations:getMyRegistration",
      args: { tournamentId },
    });
  });

  it("useMyTournaments never fires before auth is ready", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.clerkLoading);
    expect(useMyTournaments()).toBeUndefined();
    expect(lastQueryCall()).toEqual({
      name: "tournaments/registrations:listMyTournaments",
      args: "skip",
    });

    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    useMyTournaments();
    expect(lastQueryCall().args).toEqual({});
  });

  it("useMyDecklist skips without a tournament id even when ready", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    useMyDecklist(null);
    expect(lastQueryCall()).toEqual({
      name: "tournaments/decklists:getMyDecklist",
      args: "skip",
    });
  });

  it("useMyDecklist subscribes once ready with a tournament id", () => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    useMyDecklist(tournamentId);
    expect(lastQueryCall()).toEqual({
      name: "tournaments/decklists:getMyDecklist",
      args: { tournamentId },
    });
  });
});
