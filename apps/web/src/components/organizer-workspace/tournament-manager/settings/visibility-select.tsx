import { useMutation } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { EventVisibilitySelect } from '@/components/organizer-workspace/paid-event/visibility-select'

export function VisibilitySelect({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateVisibility = useMutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
  )
  return (
    <EventVisibilitySelect
      event={tournament}
      ariaLabel="Tournament visibility"
      onChange={async (visibility) => {
        await updateVisibility({ tournamentId: tournament._id, visibility })
      }}
    />
  )
}
