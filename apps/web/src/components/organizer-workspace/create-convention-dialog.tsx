import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { useOrganization } from './organization-context'
import type { FormEvent } from 'react'
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
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function CreateConventionDialog() {
  const { selectedOrganizationId } = useOrganization()
  const createConvention = useMutation(
    api.conventions.lifecycle.createConvention,
  )
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const { busy, run } = useBusyAction()
  const [name, setName] = useState('')
  const [startDateTime, setStartDateTime] = useState('')
  const [endDateTime, setEndDateTime] = useState('')
  const [capacity, setCapacity] = useState('200')
  const [isTestEvent, setIsTestEvent] = useState(false)

  const disabled = !selectedOrganizationId || busy

  function resetForm() {
    setName('')
    setStartDateTime('')
    setEndDateTime('')
    setCapacity('200')
    setIsTestEvent(false)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrganizationId) {
      return
    }
    await run(async () => {
      const startDate = new Date(startDateTime).getTime()
      const endDate = new Date(endDateTime).getTime()
      if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) {
        throw new Error('Enter valid start and end dates.')
      }
      await createConvention({
        organizationId: selectedOrganizationId,
        name,
        startDate,
        endDate,
        playerCapacity: Number.parseInt(capacity, 10),
        isTestEvent,
      })
      resetForm()
      setOpen(false)
      toast.success('Convention created.')
      try {
        await navigate({ to: '/admin/conventions' })
      } catch {
        // The convention exists; the list will show it on next visit.
      }
    }, 'Could not create convention.')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!selectedOrganizationId}>
          <Plus data-icon="inline-start" />
          Create new convention
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create convention</DialogTitle>
            <DialogDescription>
              A convention is an umbrella event: it spans a date range, sells
              badges, and holds the tournaments you attach to it.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="convention-name">Name</FieldLabel>
              <Input
                id="convention-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Winter Gathering 2027"
                disabled={disabled}
                required
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="convention-start">Starts</FieldLabel>
                <Input
                  id="convention-start"
                  type="datetime-local"
                  value={startDateTime}
                  onChange={(event) => setStartDateTime(event.target.value)}
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="convention-end">Ends</FieldLabel>
                <Input
                  id="convention-end"
                  type="datetime-local"
                  value={endDateTime}
                  onChange={(event) => setEndDateTime(event.target.value)}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="convention-capacity">
                Badge capacity
              </FieldLabel>
              <Input
                id="convention-capacity"
                type="number"
                inputMode="numeric"
                min="1"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                disabled={disabled}
                required
              />
              <FieldDescription>
                The maximum number of confirmed badges.
              </FieldDescription>
            </Field>

            <Field orientation="horizontal" data-disabled={disabled}>
              <Checkbox
                id="convention-test-event"
                checked={isTestEvent}
                onCheckedChange={(checked) => setIsTestEvent(checked === true)}
                disabled={disabled}
              />
              <FieldContent>
                <FieldLabel htmlFor="convention-test-event">
                  Mark as test convention
                </FieldLabel>
                <FieldDescription>
                  Use this for practice or setup testing. Child events created
                  from it are test events too, and it cannot charge a badge fee.
                </FieldDescription>
              </FieldContent>
            </Field>

            {!selectedOrganizationId && (
              <FieldDescription>
                Create or select an organization before creating conventions.
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
