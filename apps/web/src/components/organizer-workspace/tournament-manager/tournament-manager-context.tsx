import { createContext, useContext } from 'react'

import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

// The admin URL carries the public tournament code, but data queries need the
// Convex id. The manager layout resolves the code once and shares both here so
// child routes build URLs from `publicCode` and read data with `tournamentId`.
type ManagedTournament = {
  publicCode: string
  tournamentId: Id<'tournaments'>
}

const ManagedTournamentContext = createContext<ManagedTournament | null>(null)

export const ManagedTournamentProvider = ManagedTournamentContext.Provider

export function useManagedTournament(): ManagedTournament {
  const value = useContext(ManagedTournamentContext)
  if (!value) {
    throw new Error(
      'useManagedTournament must be used within a tournament manager route',
    )
  }
  return value
}
