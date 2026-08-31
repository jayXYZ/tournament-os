import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'

export function isPreStartLocked(tournament: Doc<'tournaments'>) {
  return (
    tournament.lifecycle !== 'setup' && tournament.lifecycle !== 'registration'
  )
}
