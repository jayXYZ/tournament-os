import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'

import { bestOfOptions } from '@tournament-os/shared/match-structure'
import {
  MAX_TOURNAMENT_PHASES,
  addTournamentCreationPhase,
  canConfigureTournamentCreationPhaseCutoff,
  canMoveTournamentCreationPhase,
  canRemoveTournamentCreationPhase,
  moveTournamentCreationPhase,
  removeTournamentCreationPhase,
  setTournamentCreationPhaseType,
  tournamentCreationPhaseCutoffFeedsPlayoff,
} from '@tournament-os/shared/tournament-creation-utils'
import { RoundConfigurationFields } from './tournament-fields'
import type { TournamentCreationPhaseForm } from '@tournament-os/shared/tournament-creation-utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
      addTournamentCreationPhase(phases, `phase-local-${crypto.randomUUID()}`),
    )
  }

  return (
    <FieldSet>
      <FieldLegend>Tournament phases</FieldLegend>
      <FieldDescription>
        Add and order Swiss phases, with an optional single-elimination playoff
        at the end — or run a single-elimination bracket on its own.
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
  const cutoffConfigurable = canConfigureTournamentCreationPhaseCutoff(
    phases,
    index,
  )
  const cutoffFeedsPlayoff = tournamentCreationPhaseCutoffFeedsPlayoff(
    phases,
    index,
  )

  return (
    <Field className="rounded-md border border-border p-3">
      <div className="grid gap-3 md:grid-cols-[180px_140px_minmax(0,1fr)_auto] md:items-end">
        <Field data-disabled={disabled || undefined}>
          <FieldLabel>Phase {index + 1}</FieldLabel>
          <Select
            value={phase.phaseType}
            onValueChange={(phaseType) =>
              onPhasesChange(
                setTournamentCreationPhaseType(
                  phases,
                  phase.id,
                  phaseType as TournamentCreationPhaseForm['phaseType'],
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
                  disabled={index !== phases.length - 1}
                >
                  Single elimination
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field data-disabled={disabled || undefined}>
          <FieldLabel>Match structure</FieldLabel>
          <Select
            value={phase.bestOf}
            onValueChange={(bestOf) =>
              onPhasesChange(
                phases.map((current) =>
                  current.id === phase.id ? { ...current, bestOf } : current,
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
                {bestOfOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    Best of {option}
                  </SelectItem>
                ))}
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
              onPhasesChange(moveTournamentCreationPhase(phases, phase.id, -1))
            }
            disabled={
              disabled || !canMoveTournamentCreationPhase(phases, phase.id, -1)
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
              onPhasesChange(moveTournamentCreationPhase(phases, phase.id, 1))
            }
            disabled={
              disabled || !canMoveTournamentCreationPhase(phases, phase.id, 1)
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
              onPhasesChange(removeTournamentCreationPhase(phases, phase.id))
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

      {cutoffConfigurable ? (
        <FieldGroup className="grid gap-3 md:grid-cols-[180px_120px]">
          <Field data-disabled={disabled || undefined}>
            <FieldLabel>Cut after this phase</FieldLabel>
            <Select
              value={phase.phaseCutoffKind}
              onValueChange={(phaseCutoffKind) =>
                onPhasesChange(
                  phases.map((current) =>
                    current.id === phase.id
                      ? {
                          ...current,
                          phaseCutoffKind:
                            phaseCutoffKind as TournamentCreationPhaseForm['phaseCutoffKind'],
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
                  <SelectItem value="none">No cut</SelectItem>
                  <SelectItem value="top_X_players">Top players</SelectItem>
                  <SelectItem value="X_points_or_more">
                    Points or more
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Players who miss the cut are eliminated when the next phase
              starts.
            </FieldDescription>
            {cutoffFeedsPlayoff ? (
              phase.phaseCutoffKind === 'X_points_or_more' ? (
                <FieldDescription className="text-destructive">
                  A points bar makes the playoff field unpredictable — the top
                  seeds get first-round byes when it falls short of a bracket,
                  and if fewer than two players clear the bar the tournament
                  completes without a playoff.
                </FieldDescription>
              ) : phase.phaseCutoffKind === 'none' ? (
                <FieldDescription>
                  With no cut the whole remaining field enters the playoff, with
                  first-round byes for the top seeds when it doesn't fill a
                  bracket.
                </FieldDescription>
              ) : (
                <FieldDescription>
                  The playoff bracket is seeded from this cut; a short field
                  gives the top seeds first-round byes.
                </FieldDescription>
              )
            ) : null}
          </Field>
          <Field
            data-disabled={
              disabled || phase.phaseCutoffKind === 'none' ? true : undefined
            }
          >
            <FieldLabel htmlFor={`${phase.id}-cutoff-value`}>
              {phase.phaseCutoffKind === 'X_points_or_more'
                ? 'Points'
                : 'Players'}
            </FieldLabel>
            <Input
              id={`${phase.id}-cutoff-value`}
              value={phase.phaseCutoffValue}
              onChange={(event) =>
                onPhasesChange(
                  phases.map((current) =>
                    current.id === phase.id
                      ? { ...current, phaseCutoffValue: event.target.value }
                      : current,
                  ),
                )
              }
              type="number"
              min={phase.phaseCutoffKind === 'X_points_or_more' ? 1 : 2}
              disabled={disabled || phase.phaseCutoffKind === 'none'}
              required={phase.phaseCutoffKind !== 'none'}
            />
          </Field>
        </FieldGroup>
      ) : null}

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
              ? index === 0
                ? "The bracket is seeded randomly from the tournament's seed."
                : "The playoff is seeded from the previous phase's cut of its final standings."
              : "Seat players alphabetically before this phase's first round for attendance and announcements."}
          </FieldDescription>
        </FieldContent>
      </Field>
    </Field>
  )
}
