import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";

// The one copy of the token-lag rule. After Clerk reports a signed-in user
// there is a window where Convex has not yet validated the token; an authed
// query fired during that window runs unauthenticated and returns null / [] —
// indistinguishable from "not registered" / "no data". Components must not
// hand-roll this with useConvexAuth: route query args through
// useAuthedQueryArgs, gate signed-in surfaces with useViewerAuthGate, and
// read useConvexAuthReadiness for any other render branch that needs the
// auth state itself.

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

// The identity signal each app supplies from its own auth provider — Clerk
// on web, Clerk Expo on native. Only nullness is consulted; `loading` is the
// provider still resolving.
export type AppAuthSnapshot = {
  user: object | null;
  loading: boolean;
};

export type ViewerAuthGate =
  // The provider is still loading, or Convex is still validating its token:
  // render a "Checking…" state, never sign-in or a data-derived empty state.
  | "pending"
  // Offer sign-in. Either nobody is signed in, or the provider has a user
  // whose token Convex refused (rejected, mis-configured JWT template, …) —
  // every authed query would stay on 'skip' forever, so mounting the
  // signed-in surface would leave it loading for good.
  | "signedOut"
  // Convex has validated the viewer: mount the surface that reads authed
  // queries.
  | "ready";

// How long a provider user may sit on a Convex `unauthenticated` verdict
// before the gate reads it as a refused token. convex-react keeps its
// signed-out verdict (not "loading") while it validates a token the provider
// issued without a page load — a session activated in place, like Clerk's
// sign-in callback before it navigates back — so that pair is briefly
// normal. Past the grace it is the refusal, and sign-in is the way out.
export const TOKEN_VALIDATION_GRACE_MS = 5_000;

// The render gate for a surface that needs a signed-in viewer. A provider
// user alone never reaches `ready`: only Convex's verdict does, since that is
// what the surface's authed queries wait on. `validationOverdue` is whether a
// provider user has waited out TOKEN_VALIDATION_GRACE_MS on an
// `unauthenticated` verdict (useViewerAuthGate tracks it).
export function viewerAuthGate(
  appAuth: AppAuthSnapshot,
  readiness: ConvexAuthReadiness,
  { validationOverdue }: { validationOverdue: boolean },
): ViewerAuthGate {
  if (appAuth.loading || readiness === "pending") return "pending";
  if (appAuth.user === null) return "signedOut";
  if (readiness === "unauthenticated") {
    return validationOverdue ? "signedOut" : "pending";
  }
  return "ready";
}

export function useViewerAuthGate(appAuth: AppAuthSnapshot): ViewerAuthGate {
  const readiness = useConvexAuthReadiness();
  const awaitingValidation =
    !appAuth.loading &&
    appAuth.user !== null &&
    readiness === "unauthenticated";
  const [validationOverdue, setValidationOverdue] = useState(false);
  useEffect(() => {
    if (!awaitingValidation) return;
    const timeout = setTimeout(
      () => setValidationOverdue(true),
      TOKEN_VALIDATION_GRACE_MS,
    );
    return () => {
      clearTimeout(timeout);
      setValidationOverdue(false);
    };
  }, [awaitingValidation]);
  return viewerAuthGate(appAuth, readiness, { validationOverdue });
}
