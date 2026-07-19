import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

export function PairingsPublicationCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updatePairingsAutoPublish = useMutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
  )
  const [busy, setBusy] = useState(false)
  const disabled =
    busy ||
    tournament.lifecycle === 'completed' ||
    tournament.lifecycle === 'cancelled'

  async function handleChange(autoPublishPairings: boolean) {
    setBusy(true)
    try {
      await updatePairingsAutoPublish({
        tournamentId: tournament._id,
        autoPublishPairings,
      })
      toast.success(
        autoPublishPairings
          ? 'New pairings will publish automatically.'
          : 'New pairings will wait for organizer approval.',
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not update pairing publication.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pairing publication</CardTitle>
        <CardDescription>
          Choose whether players see each new round as soon as its pairings are
          generated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" data-disabled={disabled}>
          <FieldContent>
            <FieldLabel htmlFor="settings-auto-publish-pairings">
              Publish pairings automatically
            </FieldLabel>
            <FieldDescription>
              When off, the dashboard advance button will ask you to publish
              each round after reviewing it. This only affects newly generated
              rounds.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="settings-auto-publish-pairings"
            checked={tournament.autoPublishPairings}
            disabled={disabled}
            onCheckedChange={(checked) => void handleChange(checked)}
            aria-label="Publish pairings automatically"
          />
        </Field>
      </CardContent>
    </Card>
  )
}
