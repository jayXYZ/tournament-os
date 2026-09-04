import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  createDefaultTournamentCreationPhase,
  toTournamentCreationPhasePayload,
  tournamentFormats,
} from '@tournament-os/shared/tournament-creation-utils'
import { useOrganization } from './organization-context'
import type {
  TournamentCreationPhaseForm,
  TournamentFormat,
} from '@tournament-os/shared/tournament-creation-utils'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { FormEvent } from 'react'
import type { TournamentBasicsValue } from '@/components/tournaments'
import { TournamentBasicsFields } from '@/components/tournaments'
import { TournamentPhaseEditor } from '@/components/tournaments/tournament-phase-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
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

const initialBasics: TournamentBasicsValue = {
  name: '',
  playerCapacity: '32',
  startDateTime: '',
}

// With a `conventionId`, the dialog creates the tournament as a child of
// that convention (api.conventions.events.createTournamentForConvention):
// the organization comes from the convention, and the test-event flag
// follows the convention's own, so the checkbox is hidden.
export function CreateTournamentDialog({
  conventionId,
}: {
  conventionId?: Id<'conventions'>
}) {
  const { selectedOrganizationId } = useOrganization()
  const createTournament = useMutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
  )
  const createForConvention = useMutation(
    api.conventions.events.createTournamentForConvention,
  )

  const [open, setOpen] = useState(false)
  const { busy, run } = useBusyAction()
  const [basics, setBasics] = useState<TournamentBasicsValue>(initialBasics)
  const [format, setFormat] = useState<TournamentFormat>('standard')
  const [decklistRequired, setDecklistRequired] = useState(false)
  const [isTestEvent, setIsTestEvent] = useState(false)
  const [phases, setPhases] = useState<Array<TournamentCreationPhaseForm>>([
    createDefaultTournamentCreationPhase('phase-1'),
  ])

  const disabled =
    (conventionId === undefined && !selectedOrganizationId) || busy

  function resetForm() {
    setBasics(initialBasics)
    setFormat('standard')
    setDecklistRequired(false)
    setIsTestEvent(false)
    setPhases([createDefaultTournamentCreationPhase('phase-1')])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (conventionId === undefined && !selectedOrganizationId) {
      return
    }

    await run(async () => {
      const shared = {
        name: basics.name,
        startDate: new Date(basics.startDateTime).getTime(),
        playerCapacity: Number.parseInt(basics.playerCapacity, 10),
        format,
        decklistRequired,
        phases: toTournamentCreationPhasePayload(phases),
      }
      if (conventionId !== undefined) {
        await createForConvention({ conventionId, ...shared })
      } else {
        await createTournament({
          organizationId: selectedOrganizationId!,
          isTestEvent,
          ...shared,
        })
      }
      resetForm()
      setOpen(false)
      toast.success('Tournament created.')
    }, 'Could not create tournament.')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          disabled={conventionId === undefined && !selectedOrganizationId}
        >
          <Plus data-icon="inline-start" />
          {conventionId !== undefined
            ? 'Create event'
            : 'Create new tournament'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create tournament</DialogTitle>
            <DialogDescription>
              Add the tournament details, Swiss rounds, and an optional
              single-elimination playoff.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <TournamentBasicsFields
              disabled={disabled}
              idPrefix="tournament"
              value={basics}
              onChange={setBasics}
            />

            <Field>
              <FieldLabel htmlFor="tournament-format">Format</FieldLabel>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as TournamentFormat)}
                disabled={disabled}
              >
                <SelectTrigger
                  id="tournament-format"
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
              <Checkbox
                id="tournament-decklist-required"
                checked={decklistRequired}
                onCheckedChange={(checked) =>
                  setDecklistRequired(checked === true)
                }
                disabled={disabled}
              />
              <FieldContent>
                <FieldLabel htmlFor="tournament-decklist-required">
                  Require decklists
                </FieldLabel>
                <FieldDescription>
                  Players submit a decklist while registration is open. You can
                  change this later in tournament settings.
                </FieldDescription>
              </FieldContent>
            </Field>

            {conventionId === undefined ? (
              <Field orientation="horizontal" data-disabled={disabled}>
                <Checkbox
                  id="tournament-test-event"
                  checked={isTestEvent}
                  onCheckedChange={(checked) =>
                    setIsTestEvent(checked === true)
                  }
                  disabled={disabled}
                />
                <FieldContent>
                  <FieldLabel htmlFor="tournament-test-event">
                    Mark as test event
                  </FieldLabel>
                  <FieldDescription>
                    Use this for practice or setup testing.
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}

            <TournamentPhaseEditor
              disabled={disabled}
              phases={phases}
              onChange={setPhases}
            />

            {conventionId === undefined && !selectedOrganizationId && (
              <FieldDescription>
                Create or select an organization before creating tournaments.
              </FieldDescription>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={disabled}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
