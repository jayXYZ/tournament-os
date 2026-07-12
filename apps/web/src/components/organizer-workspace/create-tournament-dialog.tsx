import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  addTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
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
  RoundConfigurationFields,
  TournamentBasicsFields,
} from '@/components/tournaments'
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
  FieldLegend,
  FieldSet,
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

  function handleAddPhase() {
    setPhases((current) =>
      addTournamentCreationPhase(current, `phase-${Date.now()}`),
    )
  }

  function handleRemovePhase(id: string) {
    setPhases((current) => removeTournamentCreationPhase(current, id))
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

            <FieldSet>
              <FieldLegend>Tournament phases</FieldLegend>
              <FieldGroup>
                {phases.map((phase, index) => (
                  <TournamentPhaseField
                    key={phase.id}
                    disabled={disabled}
                    index={index}
                    onRemovePhase={handleRemovePhase}
                    onPhasesChange={setPhases}
                    phase={phase}
                    phases={phases}
                  />
                ))}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddPhase}
                disabled={
                  disabled || phases.at(-1)?.phaseType === 'single_elimination'
                }
              >
                <Plus data-icon="inline-start" />
                Add phase
              </Button>
            </FieldSet>

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

function TournamentPhaseField({
  disabled,
  index,
  onRemovePhase,
  onPhasesChange,
  phase,
  phases,
}: {
  disabled: boolean
  index: number
  onRemovePhase: (id: string) => void
  onPhasesChange: (phases: Array<TournamentCreationPhaseForm>) => void
  phase: TournamentCreationPhaseForm
  phases: Array<TournamentCreationPhaseForm>
}) {
  return (
    <Field className="rounded-md border border-border p-3">
      <div className="grid gap-3 md:grid-cols-[180px_1fr_32px] md:items-end">
        <Field data-disabled={disabled || undefined}>
          <FieldLabel>Phase {index + 1}</FieldLabel>
          <Select
            value={phase.phaseType}
            onValueChange={(phaseType) =>
              onPhasesChange(
                phases.map((current) =>
                  current.id === phase.id
                    ? {
                        ...current,
                        phaseType:
                          phaseType as TournamentCreationPhaseForm['phaseType'],
                        ...(phaseType === 'single_elimination'
                          ? {
                              phaseRoundMode: 'fixed' as const,
                              phaseTotalRounds: '3',
                              playerMeeting: false,
                            }
                          : {}),
                      }
                    : current,
                ),
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="swiss">Swiss</SelectItem>
                <SelectItem
                  value="single_elimination"
                  disabled={index === 0 || index !== phases.length - 1}
                >
                  Top 8 playoff
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <RoundConfigurationFields
          disabled={disabled || phase.phaseType === 'single_elimination'}
          idPrefix={phase.id}
          value={{
            roundMode: phase.phaseRoundMode,
            totalRounds: phase.phaseTotalRounds,
          }}
          onChange={(value) =>
            onPhasesChange(
              phases.map((current) =>
                current.id === phase.id
                  ? {
                      ...current,
                      phaseRoundMode: value.roundMode,
                      phaseTotalRounds: value.totalRounds,
                    }
                  : current,
              ),
            )
          }
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onRemovePhase(phase.id)}
          disabled={
            disabled || !canRemoveTournamentCreationPhase(phases, phase.id)
          }
          aria-label={`Remove phase ${index + 1}`}
        >
          <Trash2 />
        </Button>
      </div>
      <Field
        orientation="horizontal"
        data-disabled={disabled || phase.phaseType === 'single_elimination'}
      >
        <Checkbox
          id={`${phase.id}-player-meeting`}
          checked={phase.playerMeeting}
          onCheckedChange={(checked) =>
            onPhasesChange(
              phases.map((current) =>
                current.id === phase.id
                  ? { ...current, playerMeeting: checked === true }
                  : current,
              ),
            )
          }
          disabled={disabled || phase.phaseType === 'single_elimination'}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${phase.id}-player-meeting`}>
            Hold a player meeting
          </FieldLabel>
          <FieldDescription>
            {phase.phaseType === 'single_elimination'
              ? 'The playoff begins directly from the final Swiss standings.'
              : "Seat players alphabetically before this phase's first round for attendance and announcements."}
          </FieldDescription>
        </FieldContent>
      </Field>
    </Field>
  )
}
