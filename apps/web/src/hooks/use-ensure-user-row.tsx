import { createContext, useContext, useMemo } from 'react'
import { useEnsureUserRow as useAppSignIn } from '@paper-pairings/core'
import type { ReactNode } from 'react'

type EnsureUserRowState = ReturnType<typeof useAppSignIn>

const EnsureUserRowContext = createContext<EnsureUserRowState | null>(null)

/**
 * Runs the app's sign-in (@paper-pairings/core useEnsureUserRow) once for the
 * whole app — mounted at the root, inside the Convex auth provider — so that
 * opening any page signed in creates the users row, refreshes name/avatar,
 * and claims the entries an organizer enrolled under the account's email.
 * The outcome is shared through context: a page whose UI blocks on the row
 * (settings) reads the one sign-in's `failure`/`retry` instead of running a
 * second upsert of its own.
 */
export function EnsureUserRowProvider({ children }: { children: ReactNode }) {
  const { failure, retry } = useAppSignIn()
  const state = useMemo(() => ({ failure, retry }), [failure, retry])
  return (
    <EnsureUserRowContext.Provider value={state}>
      {children}
    </EnsureUserRowContext.Provider>
  )
}

export function useEnsureUserRow(): EnsureUserRowState {
  const state = useContext(EnsureUserRowContext)
  if (state === null) {
    throw new Error('useEnsureUserRow needs an EnsureUserRowProvider ancestor')
  }
  return state
}
