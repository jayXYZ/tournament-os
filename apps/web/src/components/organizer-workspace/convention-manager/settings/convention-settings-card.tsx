import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { ConventionVisibilitySelect } from './convention-visibility-select'
import { isConventionLocked } from './is-convention-locked'
import type { FormEvent } from 'react'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { toDatetimeLocalValue } from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function ConventionSettingsCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const updateSetup = useMutation(
    api.conventions.lifecycle.updateConventionSetup,
  )
  const [name, setName] = useState(convention.name)
  const [startDateTime, setStartDateTime] = useState(
    toDatetimeLocalValue(convention.startDate),
  )
  const [endDateTime, setEndDateTime] = useState(
    toDatetimeLocalValue(convention.endDate),
  )
  const [capacity, setCapacity] = useState(String(convention.playerCapacity))
  const { busy, run } = useBusyAction()

  const locked = isConventionLocked(convention)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The datetime-local inputs are minute-truncated; submit stored values
    // unless the organizer actually changed them (same guard the tournament
    // settings card documents).
    const startDate =
      startDateTime === toDatetimeLocalValue(convention.startDate)
        ? convention.startDate
        : new Date(startDateTime).getTime()
    const endDate =
      endDateTime === toDatetimeLocalValue(convention.endDate)
        ? convention.endDate
        : new Date(endDateTime).getTime()
    await run(async () => {
      if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) {
        throw new Error('Enter valid start and end dates.')
      }
      await updateSetup({
        conventionId: convention._id,
        name,
        startDate,
        endDate,
        playerCapacity: Number.parseInt(capacity, 10),
      })
      toast.success('Convention settings saved.')
    }, 'Could not save convention settings.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convention settings</CardTitle>
        <CardDescription>
          {locked
            ? 'Core settings are locked once the convention is underway.'
            : 'Update these details any time before the convention begins.'}
        </CardDescription>
        <CardAction>
          <ConventionVisibilitySelect convention={convention} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="convention-settings-name">Name</FieldLabel>
              <Input
                id="convention-settings-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={disabled}
                required
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="convention-settings-start">
                  Starts
                </FieldLabel>
                <Input
                  id="convention-settings-start"
                  type="datetime-local"
                  value={startDateTime}
                  onChange={(event) => setStartDateTime(event.target.value)}
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="convention-settings-end">Ends</FieldLabel>
                <Input
                  id="convention-settings-end"
                  type="datetime-local"
                  value={endDateTime}
                  onChange={(event) => setEndDateTime(event.target.value)}
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="convention-settings-capacity">
                  Badge capacity
                </FieldLabel>
                <Input
                  id="convention-settings-capacity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>
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
