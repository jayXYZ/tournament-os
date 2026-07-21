import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { tournamentFormats } from '@tournament-os/shared/tournament-creation-utils'
import { isPreStartLocked } from './is-pre-start-locked'
import { PublishTournamentButton } from './publish-tournament-button'
import { VisibilitySelect } from './visibility-select'
import type { FormEvent } from 'react'
import type { TournamentFormat } from '@tournament-os/shared/tournament-creation-utils'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import type { TournamentBasicsValue } from '@/components/tournaments'
import {
  TournamentBasicsFields,
  toDatetimeLocalValue,
} from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function TournamentSettingsCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateTournamentSetup = useMutation(
    api.tournaments.lifecycle.updateTournamentSetup,
  )

  const [basics, setBasics] = useState<TournamentBasicsValue>({
    name: tournament.name,
    playerCapacity: String(tournament.playerCapacity),
    startDateTime: toDatetimeLocalValue(tournament.startDate),
  })
  const [format, setFormat] = useState<TournamentFormat>(tournament.format)
  const { busy, run } = useBusyAction()

  const locked = isPreStartLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await updateTournamentSetup({
        tournamentId: tournament._id,
        name: basics.name,
        startDate: new Date(basics.startDateTime).getTime(),
        playerCapacity: Number.parseInt(basics.playerCapacity, 10),
        format,
      })
      toast.success('Tournament settings saved.')
    }, 'Could not save tournament settings.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament settings</CardTitle>
        <CardDescription>
          {locked
            ? 'Core settings are locked after tournament play begins.'
            : 'Update these details any time before tournament play begins.'}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <VisibilitySelect tournament={tournament} />
            <PublishTournamentButton tournament={tournament} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <TournamentBasicsFields
              disabled={disabled}
              idPrefix="settings"
              value={basics}
              onChange={setBasics}
            />

            <Field>
              <FieldLabel htmlFor="settings-format">Format</FieldLabel>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as TournamentFormat)}
                disabled={disabled}
              >
                <SelectTrigger
                  id="settings-format"
                  className="w-full capitalize"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {tournamentFormats.map((tournamentFormat) => (
                      <SelectItem
                        key={tournamentFormat}
                        value={tournamentFormat}
                        className="capitalize"
                      >
                        {tournamentFormat}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <FieldSet>
              <FieldLegend>Coming soon</FieldLegend>
              <FieldDescription>
                These settings are not available yet.
              </FieldDescription>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="settings-entry-cost">
                      Entry cost
                    </FieldLabel>
                    <Input
                      id="settings-entry-cost"
                      type="number"
                      placeholder="$0.00"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-registration-deadline">
                      Registration deadline
                    </FieldLabel>
                    <Input
                      id="settings-registration-deadline"
                      type="datetime-local"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-venue">Venue</FieldLabel>
                    <Input
                      id="settings-venue"
                      placeholder="Add a location"
                      disabled
                    />
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>

            <div className="flex justify-end">
              <Button type="submit" disabled={disabled}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save settings
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
