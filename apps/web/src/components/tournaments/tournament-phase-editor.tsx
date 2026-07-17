import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'

import {
  MAX_TOURNAMENT_PHASES,
  addTournamentCreationPhase,
  canMoveTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  moveTournamentCreationPhase,
  removeTournamentCreationPhase,
} from '@tournament-os/shared/tournament-creation-utils'
import { RoundConfigurationFields } from './tournament-fields'
import type { TournamentCreationPhaseForm } from '@tournament-os/shared/tournament-creation-utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

export function TournamentPhaseEditor({
  disabled,
  phases,
  onChange,
}: {
  disabled: boolean
  phases: Array<TournamentCreationPhaseForm>
  onChange: (phases: Array<TournamentCreationPhaseForm>) => void
}) {
  function handleAddPhase() {
    onChange(
      addTournamentCreationPhase(
        phases,
        `phase-local-${crypto.randomUUID()}`,
      ),
    )
  }

  return (
    <FieldSet>
      <FieldLegend>Tournament phases</FieldLegend>
      <FieldDescription>
        Add and order Swiss phases, with an optional top-8 playoff at the end.
      </FieldDescription>
      <FieldGroup>
        {phases.map((phase, index) => (
          <TournamentPhaseField
            key={phase.id}
            disabled={disabled}
            index={index}
            onPhasesChange={onChange}
            phase={phase}
            phases={phases}
          />
        ))}
      </FieldGroup>
      <Button
        type="button"
        variant="outline"
        onClick={handleAddPhase}
        disabled={disabled || phases.length >= MAX_TOURNAMENT_PHASES}
      >
        <Plus data-icon="inline-start" />
        Add Swiss phase
      </Button>
    </FieldSet>
  )
}

function TournamentPhaseField({
  disabled,
  index,
  onPhasesChange,
  phase,
  phases,
}: {
  disabled: boolean
  index: number
  onPhasesChange: (phases: Array<TournamentCreationPhaseForm>) => void
  phase: TournamentCreationPhaseForm
  phases: Array<TournamentCreationPhaseForm>
}) {
  const isSingleElimination = phase.phaseType === 'single_elimination'

  return (
    <Field className="rounded-md border border-border p-3">
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
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
          disabled={disabled || isSingleElimination}
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
          showDynamicDescription={!isSingleElimination}
        />

        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onPhasesChange(
                moveTournamentCreationPhase(phases, phase.id, -1),
              )
            }
            disabled={
              disabled ||
              !canMoveTournamentCreationPhase(phases, phase.id, -1)
            }
            aria-label={`Move phase ${index + 1} up`}
          >
            <ArrowUp data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onPhasesChange(
                moveTournamentCreationPhase(phases, phase.id, 1),
              )
            }
            disabled={
              disabled ||
              !canMoveTournamentCreationPhase(phases, phase.id, 1)
            }
            aria-label={`Move phase ${index + 1} down`}
          >
            <ArrowDown data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              onPhasesChange(
                removeTournamentCreationPhase(phases, phase.id),
              )
            }
            disabled={
              disabled || !canRemoveTournamentCreationPhase(phases, phase.id)
            }
            aria-label={`Remove phase ${index + 1}`}
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </div>
      </div>

      <Field
        orientation="horizontal"
        data-disabled={disabled || isSingleElimination}
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
          disabled={disabled || isSingleElimination}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${phase.id}-player-meeting`}>
            Hold a player meeting
          </FieldLabel>
          <FieldDescription>
            {isSingleElimination
              ? 'The playoff begins directly from the final Swiss standings.'
              : "Seat players alphabetically before this phase's first round for attendance and announcements."}
          </FieldDescription>
        </FieldContent>
      </Field>
    </Field>
  )
}
