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
import type { FormEvent } from 'react'
import type { TournamentBasicsValue } from '@/components/tournaments'
import {
  TournamentBasicsFields,
} from '@/components/tournaments'
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

export function CreateTournamentDialog() {
  const { selectedOrganizationId } = useOrganization()
  const createTournament = useMutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
  )

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [basics, setBasics] = useState<TournamentBasicsValue>({
    name: '',
    playerCapacity: '32',
    startDateTime: '',
  })
  const [format, setFormat] = useState<TournamentFormat>('standard')
  const [isTestEvent, setIsTestEvent] = useState(false)
  const [phases, setPhases] = useState<Array<TournamentCreationPhaseForm>>([
    createDefaultTournamentCreationPhase('phase-1'),
  ])

  const disabled = !selectedOrganizationId || busy

  function resetForm() {
    setBasics({
      name: '',
      playerCapacity: '32',
      startDateTime: '',
    })
    setFormat('standard')
    setIsTestEvent(false)
    setPhases([createDefaultTournamentCreationPhase('phase-1')])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrganizationId) {
      return
    }

    setBusy(true)
    try {
      await createTournament({
        organizationId: selectedOrganizationId,
        name: basics.name,
        startDate: new Date(basics.startDateTime).getTime(),
        playerCapacity: Number.parseInt(basics.playerCapacity, 10),
        format,
        isTestEvent,
        phases: toTournamentCreationPhasePayload(phases),
      })
      resetForm()
      setOpen(false)
      toast.success('Tournament created.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not create tournament.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!selectedOrganizationId}>
          <Plus data-icon="inline-start" />
          Create new tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create tournament</DialogTitle>
            <DialogDescription>
              Add the tournament details, Swiss rounds, and an optional top-8
              playoff.
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
                id="tournament-test-event"
                checked={isTestEvent}
                onCheckedChange={(checked) => setIsTestEvent(checked === true)}
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

            <TournamentPhaseEditor
              disabled={disabled}
              phases={phases}
              onChange={setPhases}
            />

            {!selectedOrganizationId && (
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
