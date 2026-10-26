import { useAuth, useUser } from "@clerk/expo";
import type { AppAuthSnapshot } from "@paper-pairings/core";

// Native's identity signal for the shared viewer auth gate and access ladder
// (see AppAuthSnapshot in @paper-pairings/core). `user` is the active
// signed-in user as Clerk's useAuth sees it, not merely useUser's: a session
// with pending tasks (MFA, organization selection) still has a user but is
// not signed in, and Convex never authenticates it. It must read as signed
// out so AuthView, which completes those tasks, is offered — not the gate's
// unverified recovery, whose handshake restart cannot.
export function useAppAuth(): AppAuthSnapshot {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  return { user: isSignedIn && user ? user : null, loading: !isLoaded };
}
