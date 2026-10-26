import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import type { Id } from "@paper-pairings/backend/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("convex/react", () => mocks);

import {
  useAuthedQueryArgs,
  useConvexAuthReadiness,
  viewerAuthGate,
} from "./auth-readiness";
import {
  useMyBadge,
  useMyBadgeRefundFlag,
  useMyDecklist,
  useMyRefundFlag,
  useMyRegistration,
  useMyTournaments,
} from "./hooks";

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
const conventionId = "c1" as Id<"conventions">;

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

describe("viewerAuthGate", () => {
  const user = {};
  it.each([
    // Nothing is trustworthy until both the provider and Convex settle.
    [{ user: null, loading: true }, "pending", false, "pending"],
    [{ user, loading: true }, "ready", false, "pending"],
    [{ user, loading: false }, "pending", false, "pending"],
    [{ user: null, loading: false }, "pending", false, "pending"],
    [{ user: null, loading: false }, "unauthenticated", false, "signedOut"],
    // A provider user on a signed-out verdict: Convex may still be
    // validating a token issued in place, so wait out the grace…
    [{ user, loading: false }, "unauthenticated", false, "pending"],
    // …then read it as unverified, never as signed out: authed queries would
    // skip forever, and the live provider session means sign-in is not the
    // way out — a handshake restart or sign-out is.
    [{ user, loading: false }, "unauthenticated", true, "unverified"],
    // Signing out: the provider dropped the user before Convex caught up.
    [{ user: null, loading: false }, "ready", false, "signedOut"],
    [{ user, loading: false }, "ready", false, "ready"],
  ] as const)(
    "%o with Convex %s (overdue: %s) → %s",
    (appAuth, readiness, validationOverdue, gate) => {
      expect(viewerAuthGate(appAuth, readiness, { validationOverdue })).toBe(
        gate,
      );
    },
  );
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

  it.each([
    [
      "useMyBadge",
      () => useMyBadge(conventionId),
      "conventions/registrations:getMyBadge",
      { conventionId },
    ],
    [
      "useMyRefundFlag",
      () => useMyRefundFlag(tournamentId),
      "payments/queries:getMyRefundFlag",
      { tournamentId },
    ],
    [
      "useMyBadgeRefundFlag",
      () => useMyBadgeRefundFlag(conventionId),
      "payments/queries:getMyBadgeRefundFlag",
      { conventionId },
    ],
  ] as const)(
    "%s waits for auth, then subscribes",
    (_name, hook, name, args) => {
      mocks.useConvexAuth.mockReturnValue(
        authStates.clerkSignedInConvexPending,
      );
      expect(hook()).toBeUndefined();
      expect(lastQueryCall()).toEqual({ name, args: "skip" });

      mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
      hook();
      expect(lastQueryCall()).toEqual({ name, args });
    },
  );

  it.each([
    ["useMyBadge", () => useMyBadge(null)],
    ["useMyRefundFlag", () => useMyRefundFlag(null)],
    ["useMyBadgeRefundFlag", () => useMyBadgeRefundFlag(null)],
  ] as const)("%s skips without an id even when ready", (_name, hook) => {
    mocks.useConvexAuth.mockReturnValue(authStates.bothReady);
    hook();
    expect(lastQueryCall().args).toBe("skip");
  });
});
