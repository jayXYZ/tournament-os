import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FormEvent } from 'react'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function EventDetailsCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateTournamentDetails = useMutation(
    api.tournaments.lifecycle.updateTournamentDetails,
  )

  const [details, setDetails] = useState(tournament.detailsMarkdown ?? '')
  const { busy, run } = useBusyAction()

  // Details stay editable after the event starts (prize and logistics info
  // legitimately changes mid-event); only cancelled events are read-only.
  const disabled = tournament.lifecycle === 'cancelled' || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await updateTournamentDetails({
        tournamentId: tournament._id,
        detailsMarkdown: details,
      })
      toast.success('Event details saved.')
    }, 'Could not save event details.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>
          Description, prizes, and logistics shown on the public event page.
          Editable at any time, even after the event starts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <MarkdownEditor
              value={tournament.detailsMarkdown ?? ''}
              onChange={setDetails}
              disabled={disabled}
              placeholder="Tell players what to expect: schedule, prizes, entry requirements, venue details…"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={disabled}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save details
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
