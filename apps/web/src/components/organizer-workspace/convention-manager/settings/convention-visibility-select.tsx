import { useMutation } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { EventVisibilitySelect } from '@/components/organizer-workspace/paid-event/visibility-select'

export function ConventionVisibilitySelect({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const updateVisibility = useMutation(
    api.conventions.lifecycle.updateConventionVisibility,
  )
  return (
    <EventVisibilitySelect
      event={convention}
      ariaLabel="Convention visibility"
      onChange={async (visibility) => {
        await updateVisibility({ conventionId: convention._id, visibility })
      }}
    />
  )
}
