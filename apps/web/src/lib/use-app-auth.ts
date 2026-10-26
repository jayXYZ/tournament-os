import { useAuth, useClerk, useUser } from '@clerk/tanstack-react-start'

// Drop-in replacement for the WorkOS AuthKit `useAuth` shape the feature
// components were written against, backed by Clerk.
export function useAppAuth() {
  const { isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const clerk = useClerk()

  // `user` is the active signed-in user as Clerk's useAuth sees it, not
  // merely useUser's: a session with pending tasks (MFA, organization
  // selection) still has a user but is not signed in, and Convex never
  // authenticates it. It must read as signed out so the sign-in path, which
  // completes those tasks, is offered — not the viewer auth gate's unverified
  // recovery, whose handshake restart cannot.
  const user =
    isSignedIn && clerkUser
      ? {
          email: clerkUser.primaryEmailAddress?.emailAddress,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
        }
      : null

  return {
    user,
    loading: !isLoaded,
    refreshAuth: (_options?: { ensureSignedIn?: boolean }) => {
      // Return the user to the page they started from after authenticating,
      // rather than dropping them at Clerk's default redirect URL.
      const returnTo =
        typeof window !== 'undefined' ? window.location.href : undefined
      return clerk.redirectToSignIn({
        signInForceRedirectUrl: returnTo,
        signUpForceRedirectUrl: returnTo,
      })
    },
    // Clerk navigates to its after-sign-out URL (the home page) unless told
    // where to go; pass `redirectUrl` to stay on the current page.
    signOut: (options?: { redirectUrl?: string }) => clerk.signOut(options),
  }
}
