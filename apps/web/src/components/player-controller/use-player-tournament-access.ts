import { usePlayerTournamentAccess as useSharedPlayerTournamentAccess } from '@paper-pairings/core'
import type { PlayerTournamentAccess } from '@paper-pairings/core'
import { useAppAuth } from '@/lib/use-app-auth'

export type {
  PlayerRegistration,
  PlayerTournamentAccess,
  PlayerTournamentEvent,
} from '@paper-pairings/core'

// Web's binding of the shared access ladder (see @paper-pairings/core
// player-access.ts) to its auth provider. The /play and /decklist pages keep
// importing from this file so only the binding lives here.
export function usePlayerTournamentAccess(
  publicCode: string,
): PlayerTournamentAccess {
  const { user, loading } = useAppAuth()
  return useSharedPlayerTournamentAccess(publicCode, { user, loading })
}
