import { createContext, useContext } from 'react'

import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'

// The admin URL carries the public tournament code, but data queries need the
// Convex id. The manager layout resolves the code once and shares both here so
// child routes build URLs from `publicCode` and read data with `tournamentId`.
// The resolved document rides along for headings and event details.
type ManagedTournament = {
  publicCode: string
  tournamentId: Id<'tournaments'>
  tournament: Doc<'tournaments'>
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
