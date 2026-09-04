import { createContext, useContext } from 'react'

import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

// The admin URL carries the public convention code, but data queries need
// the Convex id. The manager layout resolves the code once and shares both
// here, mirroring the tournament manager context.
type ManagedConvention = {
  publicCode: string
  conventionId: Id<'conventions'>
}

const ManagedConventionContext = createContext<ManagedConvention | null>(null)

export const ManagedConventionProvider = ManagedConventionContext.Provider

export function useManagedConvention(): ManagedConvention {
  const value = useContext(ManagedConventionContext)
  if (!value) {
    throw new Error(
      'useManagedConvention must be used within a convention manager route',
    )
  }
  return value
}
