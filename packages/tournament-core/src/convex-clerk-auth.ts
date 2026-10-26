import { ConvexProviderWithAuth } from "convex/react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// The slice of Clerk's useAuth the Convex handshake reads — the shape
// convex/react-clerk's ConvexProviderWithClerk accepts, so the web and Expo
// Clerk SDKs' useAuth both fit.
export type ClerkUseAuth = () => {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  getToken: (options: {
    template?: "convex";
    skipCache?: boolean;
  }) => Promise<string | null>;
  orgId: string | undefined | null;
  orgRole: string | undefined | null;
  sessionClaims: Record<string, unknown> | undefined | null;
};

type ConvexAuthClient = ComponentProps<typeof ConvexProviderWithAuth>["client"];

const RestartConvexAuthContext = createContext<(() => void) | null>(null);

// convex/react-clerk's ConvexProviderWithClerk, plus a way to restart the
// Convex handshake without a page load.
//
// convex-react runs the handshake — fetch a Clerk token, send it, wait for
// the server's verdict — once per `setAuth`, and ConvexProviderWithAuth calls
// `setAuth` only when the provider's signed-in flag or its token fetcher
// changes. A handshake that ends without a verified identity (the server
// refused the token, twice over with a fresh one, or Clerk's getToken threw
// and the fetcher answered null) settles the client on `unauthenticated` and
// it never tries again, while Clerk still reports a signed-in user. Nothing
// short of a new `setAuth` recovers, and signing in again cannot cause one:
// the Clerk session is already live, so the provider's flag never changes.
//
// The restart handle bumps a counter the token fetcher closes over, so its
// identity changes and ConvexProviderWithAuth tears the old auth down
// (clearAuth, readiness back to `pending`) and runs `setAuth` afresh. That is
// its documented contract: "If the useAuth prop function updates causing a
// rerender then auth state will transition to loading and the
// fetchAccessToken() function called again."
export function ConvexClerkAuthProvider({
  children,
  client,
  useAuth,
}: {
  children: ReactNode;
  client: ConvexAuthClient;
  useAuth: ClerkUseAuth;
}) {
  const [attempt, setAttempt] = useState(0);
  const restart = useCallback(() => setAttempt((n) => n + 1), []);
  const useAuthForConvex = useMemo(
    () => convexAuthHook(useAuth, attempt),
    [useAuth, attempt],
  );
  return createElement(
    RestartConvexAuthContext.Provider,
    { value: restart },
    createElement(
      ConvexProviderWithAuth,
      { client, useAuth: useAuthForConvex },
      children,
    ),
  );
}

// Restarts the Convex auth handshake (see ConvexClerkAuthProvider). Readiness
// reads `pending` until the server's new verdict lands, so the viewer auth
// gate shows its checking state rather than a flash of anything else.
export function useRestartConvexAuth(): () => void {
  const restart = useContext(RestartConvexAuthContext);
  if (restart === null) {
    throw new Error(
      "useRestartConvexAuth needs a ConvexClerkAuthProvider ancestor",
    );
  }
  return restart;
}

// Mirrors convex/react-clerk's adapter. Clerk's native Convex integration
// stamps session tokens with aud "convex"; otherwise the `convex` JWT
// template is used. A thrown getToken reads as "no token" (null), which the
// client reports as unauthenticated rather than as an error — the same
// signal as a refused token, hence the gate's `unverified` wording.
function convexAuthHook(useAuth: ClerkUseAuth, attempt: number) {
  return function useAuthForConvex() {
    const { isLoaded, isSignedIn, getToken, orgId, orgRole, sessionClaims } =
      useAuth();
    const fetchAccessToken = useCallback(
      async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
        try {
          return sessionClaims?.aud === "convex"
            ? await getToken({ skipCache: forceRefreshToken })
            : await getToken({
                template: "convex",
                skipCache: forceRefreshToken,
              });
        } catch {
          return null;
        }
      },
      // Only the auth context Clerk wants to be reactive, plus the restart
      // handle. getToken is deliberately left out, as in convex/react-clerk:
      // Clerk Expo's useAuth is not memoized, and getToken reads the live
      // session at call time, so a stale closure is harmless.
      [orgId, orgRole, attempt],
    );
    return useMemo(
      () => ({
        isLoading: !isLoaded,
        isAuthenticated: isSignedIn ?? false,
        fetchAccessToken,
      }),
      [isLoaded, isSignedIn, fetchAccessToken],
    );
  };
}
