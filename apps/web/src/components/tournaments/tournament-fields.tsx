import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type TournamentBasicsValue = {
  name: string
  playerCapacity: string
  startDateTime: string
}

export function TournamentBasicsFields({
  className,
  disabled,
  idPrefix,
  onChange,
  value,
}: {
  className?: string
  disabled: boolean
  idPrefix: string
  onChange: (value: TournamentBasicsValue) => void
  value: TournamentBasicsValue
}) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-[1.2fr_1fr_120px]', className)}>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="Store Championship"
          disabled={disabled}
          required
        />
      </Field>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-start`}>Start date</FieldLabel>
        <Input
          id={`${idPrefix}-start`}
          value={value.startDateTime}
          onChange={(event) =>
            onChange({ ...value, startDateTime: event.target.value })
          }
          type="datetime-local"
          disabled={disabled}
          required
        />
      </Field>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-capacity`}>Capacity</FieldLabel>
        <Input
          id={`${idPrefix}-capacity`}
          value={value.playerCapacity}
          onChange={(event) =>
            onChange({ ...value, playerCapacity: event.target.value })
          }
          type="number"
          min={2}
          max={2048}
          disabled={disabled}
          required
        />
      </Field>
    </div>
  )
}

export type RoundConfigurationValue = {
  roundMode: Doc<'tournamentPhases'>['phaseRoundMode']
  totalRounds: string
}

export function RoundConfigurationFields({
  className,
  disabled,
  idPrefix,
  onChange,
  showDynamicDescription = false,
  value,
}: {
  className?: string
  disabled: boolean
  idPrefix: string
  onChange: (value: RoundConfigurationValue) => void
  showDynamicDescription?: boolean
  value: RoundConfigurationValue
}) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-[1fr_120px]', className)}>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel>Rounds</FieldLabel>
        <Select
          value={value.roundMode}
          onValueChange={(roundMode) =>
            onChange({
              ...value,
              roundMode: roundMode as Doc<'tournamentPhases'>['phaseRoundMode'],
            })
          }
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="dynamic">Dynamic rounds</SelectItem>
              <SelectItem value="fixed">Fixed rounds</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {showDynamicDescription ? (
          <FieldDescription>
            Dynamic rounds are calculated from the number of active players when
            the phase starts.
          </FieldDescription>
        ) : null}
      </Field>
      <Field
        data-disabled={
          disabled || value.roundMode === 'dynamic' ? true : undefined
        }
      >
        <FieldLabel htmlFor={`${idPrefix}-total-rounds`}>
          Total rounds
        </FieldLabel>
        <Input
          id={`${idPrefix}-total-rounds`}
          value={value.totalRounds}
          onChange={(event) =>
            onChange({ ...value, totalRounds: event.target.value })
          }
          type="number"
          min={1}
          max={16}
          disabled={disabled || value.roundMode === 'dynamic'}
          required={value.roundMode === 'fixed'}
        />
      </Field>
    </div>
  )
}
