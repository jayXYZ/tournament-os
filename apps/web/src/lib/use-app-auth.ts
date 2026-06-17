import { useClerk, useUser } from '@clerk/tanstack-react-start'

// Drop-in replacement for the WorkOS AuthKit `useAuth` shape the feature
// components were written against, backed by Clerk.
export function useAppAuth() {
  const { user: clerkUser, isLoaded } = useUser()
  const clerk = useClerk()

  const user = clerkUser
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
    signOut: () => clerk.signOut(),
  }
}
