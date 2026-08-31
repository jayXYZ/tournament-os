import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'

export type PairingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundPairings
>[number]
