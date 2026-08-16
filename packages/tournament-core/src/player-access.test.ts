import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerTournamentAccess } from "./player-access.ts";
import type {
  PlayerRegistration,
  PlayerTournamentEvent,
} from "./player-access.ts";
import type { ConvexAuthReadiness } from "./auth-readiness.ts";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useConvexAuthReadiness: vi.fn(),
  useMyRegistration: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("./auth-readiness", () => ({
  useConvexAuthReadiness: mocks.useConvexAuthReadiness,
}));

vi.mock("./hooks", () => ({
  useMyRegistration: mocks.useMyRegistration,
}));

const event = {
  tournament: { _id: "t1", name: "Friday Night Modern" },
} as unknown as PlayerTournamentEvent;

const confirmed = {
  _id: "r1",
  entryStatus: "confirmed",
} as unknown as PlayerRegistration;

const cancelled = {
  _id: "r1",
  entryStatus: "cancelled",
} as unknown as PlayerRegistration;

// One row per input: the app auth provider's state, Convex auth readiness,
// what the event lookup resolves to, and what the server would answer for
// getMyRegistration if the query were allowed to run. useMyRegistration is
// emulated to its contract as pinned by this package's own tests: the
// registration answer is withheld (undefined) until Convex auth is ready.
function run(scenario: {
  provider: "loading" | "signedOut" | "signedIn";
  convex: ConvexAuthReadiness;
  event: PlayerTournamentEvent | null | undefined;
  registration?: PlayerRegistration | null | undefined;
}) {
  mocks.useConvexAuthReadiness.mockReturnValue(scenario.convex);
  mocks.useMyRegistration.mockImplementation((tournamentId) =>
    scenario.convex === "ready" && tournamentId
      ? scenario.registration
      : undefined,
  );
  mocks.useQuery.mockReturnValue(scenario.event);
  return usePlayerTournamentAccess("CODE01", {
    user: scenario.provider === "signedIn" ? { email: "p@example.com" } : null,
    loading: scenario.provider === "loading",
  });
}

beforeEach(() => {
  mocks.useConvexAuthReadiness.mockReset();
  mocks.useMyRegistration.mockReset();
  mocks.useQuery.mockReset();
});

describe("usePlayerTournamentAccess", () => {
  it("loading while the auth provider is still resolving", () => {
    expect(
      run({ provider: "loading", convex: "pending", event: undefined }),
    ).toEqual({ state: "loading", event: null });
  });

  it("loading while the event lookup is in flight", () => {
    expect(
      run({
        provider: "signedOut",
        convex: "unauthenticated",
        event: undefined,
      }),
    ).toEqual({ state: "loading", event: null });
  });

  it("loading for a signed-in viewer whose null event may be a private one (Convex auth pending)", () => {
    expect(
      run({ provider: "signedIn", convex: "pending", event: null }),
    ).toEqual({
      state: "loading",
      event: null,
    });
  });

  it("loading through the token-lag window — never a false notRegistered", () => {
    // The server would answer null here; the seam keeps the question unasked
    // until Convex validates the token.
    expect(
      run({
        provider: "signedIn",
        convex: "pending",
        event,
        registration: null,
      }),
    ).toEqual({ state: "loading", event });
  });

  it("loading while the registration query is in flight after auth is ready", () => {
    expect(
      run({
        provider: "signedIn",
        convex: "ready",
        event,
        registration: undefined,
      }),
    ).toEqual({ state: "loading", event });
  });

  it("notFound for a wrong public code with no signed-in viewer", () => {
    expect(
      run({ provider: "signedOut", convex: "unauthenticated", event: null }),
    ).toEqual({ state: "notFound" });
  });

  it("notFound for a signed-in viewer once Convex auth settles and the event is still null", () => {
    expect(run({ provider: "signedIn", convex: "ready", event: null })).toEqual(
      {
        state: "notFound",
      },
    );
  });

  it("signedOut for a resolved event without a signed-in viewer", () => {
    expect(
      run({ provider: "signedOut", convex: "unauthenticated", event }),
    ).toEqual({ state: "signedOut", event });
  });

  it("notRegistered when the server finds no registration row", () => {
    expect(
      run({ provider: "signedIn", convex: "ready", event, registration: null }),
    ).toEqual({ state: "notRegistered", event });
  });

  it("notRegistered for a cancelled registration — entryStatus must be confirmed", () => {
    expect(
      run({
        provider: "signedIn",
        convex: "ready",
        event,
        registration: cancelled,
      }),
    ).toEqual({ state: "notRegistered", event });
  });

  it("ready with the event and confirmed registration", () => {
    expect(
      run({
        provider: "signedIn",
        convex: "ready",
        event,
        registration: confirmed,
      }),
    ).toEqual({ state: "ready", event, registration: confirmed });
  });
});
