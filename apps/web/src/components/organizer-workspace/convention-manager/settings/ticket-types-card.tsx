import { useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { isConventionLocked } from './is-convention-locked'
import type { FormEvent } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import {
  FeePreviewPanel,
  StripeOnboardingNotice,
  useFeePreview,
} from '@/components/organizer-workspace/paid-event/fee-preview'
import {
  parseDollarsToCents,
  toDollarsValue,
} from '@/components/organizer-workspace/paid-event/money'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { toDatetimeLocalValue } from '@/components/tournaments'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'
import { formatCents } from '@/lib/money'

type OrganizerTicketType = FunctionReturnType<
  typeof api.conventions.ticketTypes.listTicketTypesForOrganizer
>[number]

// The convention's passes (ADR 0004): each ticket type composes a price, a
// per-type capacity, an admission window, a sale window, and the child
// events it comps. This card lists them and hosts the add/edit dialog.
export function TicketTypesCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const locked = isConventionLocked(convention)
  const ticketTypes = useQuery(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId: convention._id },
  )
  const deleteTicketType = useMutation(
    api.conventions.ticketTypes.deleteTicketType,
  )
  const [editing, setEditing] = useState<OrganizerTicketType | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tickets</CardTitle>
        <CardDescription>
          {locked
            ? 'Ticket settings are locked once the convention is over.'
            : 'The passes this convention sells. A ticket can cover the whole convention or single days, carry its own price and capacity, and include free entry to specific events. Sales end automatically when the ticket’s last admitted day does.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ticketTypes === undefined ? (
          <Skeleton className="h-24" />
        ) : (
          ticketTypes.map((ticketType) => (
            <div
              key={ticketType._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{ticketType.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {ticketType.priceCents > 0
                      ? formatCents(ticketType.priceCents)
                      : 'Free'}
                  </span>
                  {ticketType.onSale ? (
                    <Badge variant="outline">On sale</Badge>
                  ) : (
                    <Badge variant="secondary">Not on sale</Badge>
                  )}
                  {ticketType.priceLocked ? (
                    <Badge variant="secondary">Price locked</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {ticketType.confirmedCount}
                  {ticketType.capacity !== undefined
                    ? ` / ${ticketType.capacity}`
                    : ''}{' '}
                  registered
                  {ticketType.includedTournamentIds.length > 0
                    ? ` · includes ${ticketType.includedTournamentIds.length} ${
                        ticketType.includedTournamentIds.length === 1
                          ? 'event'
                          : 'events'
                      }`
                    : ''}
                </p>
              </div>
              {locked ? null : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(ticketType)
                      setDialogOpen(true)
                    }}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                  <ConfirmActionDialog
                    trigger={
                      <Button type="button" variant="outline" size="sm">
                        <Trash2 data-icon="inline-start" />
                        Delete
                      </Button>
                    }
                    icon={<Trash2 />}
                    title={`Delete ${ticketType.name}?`}
                    description="A ticket type can only be deleted while nothing references it — once anyone has registered or paid, end its sale instead."
                    actionLabel="Delete"
                    failureMessage="Could not delete ticket type."
                    onConfirm={async () => {
                      await deleteTicketType({ ticketTypeId: ticketType._id })
                      toast.success('Ticket type deleted.')
                    }}
                  />
                </div>
              )}
            </div>
          ))
        )}
        {locked ? null : (
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus data-icon="inline-start" />
              Add ticket type
            </Button>
          </div>
        )}
        {dialogOpen ? (
          <TicketTypeDialog
            key={editing?._id ?? 'new'}
            convention={convention}
            ticketType={editing}
            onClose={() => setDialogOpen(false)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function TicketTypeDialog({
  convention,
  ticketType,
  onClose,
}: {
  convention: Doc<'conventions'>
  ticketType: OrganizerTicketType | null
  onClose: () => void
}) {
  const createTicketType = useMutation(
    api.conventions.ticketTypes.createTicketType,
  )
  const updateTicketType = useMutation(
    api.conventions.ticketTypes.updateTicketType,
  )
  const paymentSettings = useQuery(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId: convention.organizationId },
  )
  const { results: childEvents } = usePaginatedQuery(
    api.conventions.events.listChildEvents,
    { conventionId: convention._id },
    { initialNumItems: 100 },
  )
  const { busy, run } = useBusyAction()

  const [name, setName] = useState(ticketType?.name ?? '')
  const [description, setDescription] = useState(ticketType?.description ?? '')
  const [price, setPrice] = useState(toDollarsValue(ticketType?.priceCents))
  const [capacity, setCapacity] = useState(
    ticketType?.capacity !== undefined ? String(ticketType.capacity) : '',
  )
  const [admissionStart, setAdmissionStart] = useState(
    ticketType?.admissionStartDate !== undefined
      ? toDatetimeLocalValue(ticketType.admissionStartDate)
      : '',
  )
  const [admissionEnd, setAdmissionEnd] = useState(
    ticketType?.admissionEndDate !== undefined
      ? toDatetimeLocalValue(ticketType.admissionEndDate)
      : '',
  )
  const [saleStart, setSaleStart] = useState(
    ticketType?.saleStartDate !== undefined
      ? toDatetimeLocalValue(ticketType.saleStartDate)
      : '',
  )
  const [saleEnd, setSaleEnd] = useState(
    ticketType?.saleEndDate !== undefined
      ? toDatetimeLocalValue(ticketType.saleEndDate)
      : '',
  )
  const [includedIds, setIncludedIds] = useState<Set<Id<'tournaments'>>>(
    () => new Set(ticketType?.includedTournamentIds ?? []),
  )

  const payoutsReady = paymentSettings?.connection?.payoutsReady ?? false
  const priceLocked = ticketType?.priceLocked ?? false
  const draftCents = parseDollarsToCents(price)
  const preview = useFeePreview(draftCents)

  function parseOptionalDate(value: string, label: string) {
    if (value === '') {
      return undefined
    }
    const parsed = new Date(value).getTime()
    if (!Number.isFinite(parsed)) {
      throw new Error(`Enter a valid ${label}.`)
    }
    return parsed
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      if (Number.isNaN(draftCents)) {
        throw new Error('Enter a valid ticket price.')
      }
      const inputs = {
        name,
        description: description === '' ? undefined : description,
        priceCents: draftCents,
        capacity: capacity === '' ? undefined : Number.parseInt(capacity, 10),
        admissionStartDate: parseOptionalDate(
          admissionStart,
          'admission start',
        ),
        admissionEndDate: parseOptionalDate(admissionEnd, 'admission end'),
        saleStartDate: parseOptionalDate(saleStart, 'sale start'),
        saleEndDate: parseOptionalDate(saleEnd, 'sale end'),
        includedTournamentIds: [...includedIds],
      }
      if (ticketType) {
        await updateTicketType({ ticketTypeId: ticketType._id, ...inputs })
      } else {
        await createTicketType({ conventionId: convention._id, ...inputs })
      }
      toast.success(ticketType ? 'Ticket type saved.' : 'Ticket type added.')
      onClose()
    }, 'Could not save the ticket type.')
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ticketType ? `Edit ${ticketType.name}` : 'Add ticket type'}
          </DialogTitle>
          <DialogDescription>
            Leave the admission window empty for a pass that covers the whole
            convention; a day pass is a one-day window. Sales end by the last
            admitted day unless an earlier sale end is set.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ticket-type-name">Name</FieldLabel>
                <Input
                  id="ticket-type-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-type-price">Price (USD)</FieldLabel>
                <Input
                  id="ticket-type-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  disabled={priceLocked}
                />
                <FieldDescription>
                  {priceLocked
                    ? 'Locked — someone has already paid for this ticket.'
                    : 'Leave empty for a free ticket.'}
                </FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="ticket-type-description">
                Description
              </FieldLabel>
              <Input
                id="ticket-type-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ticket-type-capacity">Capacity</FieldLabel>
                <Input
                  id="ticket-type-capacity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  placeholder="No limit"
                />
                <FieldDescription>
                  Within the convention’s overall badge capacity.
                </FieldDescription>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ticket-type-admission-start">
                  Admits from
                </FieldLabel>
                <Input
                  id="ticket-type-admission-start"
                  type="datetime-local"
                  value={admissionStart}
                  onChange={(event) => setAdmissionStart(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-type-admission-end">
                  Admits until
                </FieldLabel>
                <Input
                  id="ticket-type-admission-end"
                  type="datetime-local"
                  value={admissionEnd}
                  onChange={(event) => setAdmissionEnd(event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ticket-type-sale-start">
                  Sale starts
                </FieldLabel>
                <Input
                  id="ticket-type-sale-start"
                  type="datetime-local"
                  value={saleStart}
                  onChange={(event) => setSaleStart(event.target.value)}
                />
                <FieldDescription>
                  Empty: on sale from publication.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-type-sale-end">
                  Sale ends
                </FieldLabel>
                <Input
                  id="ticket-type-sale-end"
                  type="datetime-local"
                  value={saleEnd}
                  onChange={(event) => setSaleEnd(event.target.value)}
                />
                <FieldDescription>
                  Empty: when its last admitted day ends.
                </FieldDescription>
              </Field>
            </div>
            {childEvents.length > 0 ? (
              <Field>
                <FieldLabel>Included events</FieldLabel>
                <FieldDescription>
                  Holders of this ticket register for these events free.
                </FieldDescription>
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                  {childEvents.map((child) => (
                    <label
                      key={child._id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={includedIds.has(child._id)}
                        onCheckedChange={(checked) => {
                          setIncludedIds((current) => {
                            const next = new Set(current)
                            if (checked === true) {
                              next.add(child._id)
                            } else {
                              next.delete(child._id)
                            }
                            return next
                          })
                        }}
                      />
                      {child.name}
                    </label>
                  ))}
                </div>
              </Field>
            ) : null}

            {paymentSettings !== undefined &&
            !payoutsReady &&
            draftCents > 0 &&
            !priceLocked ? (
              <StripeOnboardingNotice
                hasConnection={Boolean(paymentSettings.connection)}
                chargingPhrase="for tickets"
              />
            ) : null}

            <FeePreviewPanel
              preview={preview}
              payersLabel="Attendees"
              paidOutLabel="ticket"
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {ticketType ? 'Save ticket type' : 'Add ticket type'}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
