import { useConvexAuth } from "convex/react";

// The one copy of the token-lag rule. After Clerk reports a signed-in user
// there is a window where Convex has not yet validated the token; an authed
// query fired during that window runs unauthenticated and returns null / [] —
// indistinguishable from "not registered" / "no data". Components must not
// hand-roll this with useConvexAuth: route query args through
// useAuthedQueryArgs, and read useConvexAuthReadiness for render branches
// that need the auth state itself.

export type ConvexAuthReadiness =
  // Clerk is still loading, or Convex is still validating the token. There is
  // no trustworthy answer yet — render loading, never "signed out" or a
  // data-derived empty state.
  | "pending"
  // Settled: no signed-in viewer.
  | "unauthenticated"
  // Convex has validated the viewer's token; authed queries can be trusted.
  | "ready";

export function useConvexAuthReadiness(): ConvexAuthReadiness {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isAuthenticated) return "ready";
  return isLoading ? "pending" : "unauthenticated";
}

// "Your args, or 'skip' until the Convex identity is trustworthy." Pass null
// while the caller's own preconditions are unmet (route param unresolved,
// registration unconfirmed, …) to keep the subscription skipped either way.
export function useAuthedQueryArgs<Args>(args: Args | null): Args | "skip" {
  return useConvexAuthReadiness() === "ready" && args !== null ? args : "skip";
}
