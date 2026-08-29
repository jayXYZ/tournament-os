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
  FieldContent,
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
import { Switch } from '@/components/ui/switch'
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
  const [decklistRequired, setDecklistRequired] = useState(
    tournament.decklistRequired,
  )
  const [registrationRequiresApproval, setRegistrationRequiresApproval] =
    useState(tournament.registrationRequiresApproval)
  const { busy, run } = useBusyAction()

  const locked = isPreStartLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The datetime-local input is minute-truncated, so an untouched field
    // would round-trip as a spuriously different timestamp and trigger the
    // backend's per-registration start-date sync. Submit the stored value
    // unless the organizer actually picked a different time.
    const startDate =
      basics.startDateTime === toDatetimeLocalValue(tournament.startDate)
        ? tournament.startDate
        : new Date(basics.startDateTime).getTime()
    await run(async () => {
      // new Date(...).getTime() is NaN for an unparseable datetime-local
      // value; catch it here so the organizer gets a clear message instead
      // of a rejected mutation (the mutation also rejects non-finite dates
      // server-side, since it's public API).
      if (!Number.isFinite(startDate)) {
        throw new Error('Enter a valid start date and time.')
      }
      await updateTournamentSetup({
        tournamentId: tournament._id,
        name: basics.name,
        startDate,
        playerCapacity: Number.parseInt(basics.playerCapacity, 10),
        format,
        decklistRequired,
        registrationRequiresApproval,
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

            <Field orientation="horizontal" data-disabled={disabled}>
              <FieldContent>
                <FieldLabel htmlFor="settings-decklist-required">
                  Require decklists
                </FieldLabel>
                <FieldDescription>
                  Players submit a decklist while registration is open;
                  submissions freeze when the tournament starts. Turning this
                  off keeps any submitted lists but closes submission.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-decklist-required"
                checked={decklistRequired}
                disabled={disabled}
                onCheckedChange={setDecklistRequired}
                aria-label="Require decklists"
              />
            </Field>

            <Field orientation="horizontal" data-disabled={disabled}>
              <FieldContent>
                <FieldLabel htmlFor="settings-registration-approval">
                  Require registration approval
                </FieldLabel>
                <FieldDescription>
                  New registrations arrive as pending applications you approve,
                  waitlist, or reject from the Registrations tab. Turning this
                  off admits new registrations directly but leaves already-filed
                  applications awaiting your review.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-registration-approval"
                checked={registrationRequiresApproval}
                disabled={disabled}
                onCheckedChange={setRegistrationRequiresApproval}
                aria-label="Require registration approval"
              />
            </Field>

            <FieldSet>
              <FieldLegend>Coming soon</FieldLegend>
              <FieldDescription>
                These settings are not available yet.
              </FieldDescription>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
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
