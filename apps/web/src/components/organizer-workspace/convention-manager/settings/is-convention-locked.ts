import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

// Settings are locked once the convention is over (ADR 0004: there is no
// in_progress phase, so "registration" is the whole live run and stays
// editable throughout).
export function isConventionLocked(convention: Doc<'conventions'>) {
  return (
    convention.lifecycle !== 'setup' && convention.lifecycle !== 'registration'
  )
}
