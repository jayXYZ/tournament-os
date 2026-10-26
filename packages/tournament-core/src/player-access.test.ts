import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerTournamentAccess } from "./player-access.ts";
import type {
  PlayerRegistration,
  PlayerTournamentEvent,
} from "./player-access.ts";
import { viewerAuthGate } from "./auth-readiness.ts";
import type { ConvexAuthReadiness } from "./auth-readiness.ts";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useViewerAuthGate: vi.fn(),
  useMyRegistration: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

// The hook is called here as a plain function — this package has no React
// renderer to run useViewerAuthGate's grace timer — so only the timer is
// stood in for: the real viewerAuthGate decides, fed the scenario's Convex
// readiness and whether TOKEN_VALIDATION_GRACE_MS has run out.
vi.mock("./auth-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-readiness.ts")>()),
  useViewerAuthGate: mocks.useViewerAuthGate,
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
// whether a provider user has outwaited the token-validation grace on an
// `unauthenticated` verdict, what the event lookup resolves to, and what the
// server would answer for getMyRegistration if the query were allowed to
// run. useMyRegistration is emulated to its contract as pinned by this
// package's own tests: the registration answer is withheld (undefined) until
// Convex auth is ready.
function run(scenario: {
  provider: "loading" | "signedOut" | "signedIn";
  convex: ConvexAuthReadiness;
  graceElapsed?: boolean;
  event: PlayerTournamentEvent | null | undefined;
  registration?: PlayerRegistration | null | undefined;
}) {
  mocks.useViewerAuthGate.mockImplementation((appAuth) =>
    viewerAuthGate(appAuth, scenario.convex, {
      validationOverdue: scenario.graceElapsed ?? false,
    }),
  );
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
  mocks.useViewerAuthGate.mockReset();
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

  it("loading with the event while the auth provider is still resolving — a resolved event does not wait on auth", () => {
    expect(run({ provider: "loading", convex: "pending", event })).toEqual({
      state: "loading",
      event,
    });
  });

  it("loading while Convex validates a token issued by an in-place sign-in", () => {
    // convex-react reports this window as signed out, not loading.
    expect(
      run({
        provider: "signedIn",
        convex: "unauthenticated",
        event,
        registration: confirmed,
      }),
    ).toEqual({ state: "loading", event });
  });

  it("loading for a null event while Convex validates an in-place sign-in — it may be a private one", () => {
    expect(
      run({ provider: "signedIn", convex: "unauthenticated", event: null }),
    ).toEqual({ state: "loading", event: null });
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

  it("unverified with a null event once the grace runs out on a provider user — not notFound", () => {
    // The server answers null for a private event it sees no identity on,
    // just as for a wrong code, and the shell's handshake restart may still
    // resolve it, so the null rides along instead of settling as notFound.
    expect(
      run({
        provider: "signedIn",
        convex: "unauthenticated",
        graceElapsed: true,
        event: null,
      }),
    ).toEqual({ state: "unverified", event: null });
  });

  it("signedOut for a resolved event without a signed-in viewer", () => {
    expect(
      run({ provider: "signedOut", convex: "unauthenticated", event }),
    ).toEqual({ state: "signedOut", event });
  });

  it("unverified for a resolved event once the grace runs out on a provider user", () => {
    // Every authed query would stay on 'skip' — without this the ladder sat
    // in loading forever. It is not signedOut: the provider session is live,
    // so the shell offers a handshake restart and sign-out, not sign-in.
    expect(
      run({
        provider: "signedIn",
        convex: "unauthenticated",
        graceElapsed: true,
        event,
        registration: confirmed,
      }),
    ).toEqual({ state: "unverified", event });
  });

  it("signedOut while signing out — the provider dropped the user before Convex caught up", () => {
    expect(run({ provider: "signedOut", convex: "ready", event })).toEqual({
      state: "signedOut",
      event,
    });
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
