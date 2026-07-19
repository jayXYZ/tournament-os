import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

export function isPreStartLocked(tournament: Doc<'tournaments'>) {
  return (
    tournament.lifecycle !== 'setup' &&
    tournament.lifecycle !== 'registration'
  )
}
