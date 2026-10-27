import { useState } from 'react'
import { useMutation } from 'convex/react'
import { UserPen, UserPlus, UserRoundPlus } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { toast } from 'sonner'
import type { FormEvent, ReactNode } from 'react'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

// The organizer's direct enrollments (CONTEXT.md "Enrollment") and the
// follow-up that names an entry still awaiting player details. Each dialog
// asks for exactly one thing: "Enroll player" an email, "Add guest" a name,
// "Continue as guest" a name. Both enrollments seat the player at once —
// confirmed, counted against capacity, no in-app entry payment — and differ
// only in what the entry has to start with: a guest added by name is ready
// to play; an entry enrolled by email awaits player details until the
// player opens the app signed in with a name, or the organizer names them.
// Nothing here says whether an email has an account: every email enrollment
// lands in the same state, by design.

// Longest name the enrollment accepts; mirrors MAX_ENROLLMENT_NAME_LENGTH in
// the backend's model/roster.ts, which is what actually refuses a longer one.
export const ENROLLMENT_NAME_MAX_LENGTH = 80

// Whether the server would accept an enrollment right now: it takes a seat,
// so only while registration is open and a seat is free.
export function canEnroll(tournament: Doc<'tournaments'> | undefined) {
  return (
    tournament !== undefined &&
    tournament.lifecycle === 'registration' &&
    tournament.confirmedRegistrationCount < tournament.playerCapacity
  )
}

// The shared single-field dialog: one input, one submit, locked while the
// mutation runs. The form's `required` and type attributes are the first
// line of validation; the server's refusal (toasted by useBusyAction) is
// the final word.
function SingleFieldDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  input,
  submitLabel,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: ReactNode
  title: string
  description: string
  input: ReactNode
  submitLabel: string
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next)
        }
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>{input}</FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// "Enroll player": seat a player by email. The entry is confirmed now and
// shows as "Awaiting player details" until it has a name.
export function EnrollPlayerDialog({
  tournament,
}: {
  tournament: Doc<'tournaments'> | undefined
}) {
  const enrollPlayer = useMutation(api.tournaments.registrations.enrollPlayer)
  const [open, setOpen] = useState(false)
  const { busy, run } = useBusyAction()
  const [email, setEmail] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tournament) {
      return
    }
    await run(async () => {
      const trimmedEmail = email.trim()
      await enrollPlayer({ tournamentId: tournament._id, email: trimmedEmail })
      // Same words whoever the email belongs to.
      toast.success(
        `${trimmedEmail} has been enrolled. Their entry is awaiting player details.`,
      )
      setEmail('')
      setOpen(false)
    }, 'Could not enroll player.')
  }

  return (
    <SingleFieldDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          type="button"
          variant="outline"
          disabled={!canEnroll(tournament)}
        >
          <UserPlus data-icon="inline-start" />
          Enroll player
        </Button>
      }
      title="Enroll a player"
      description="Seat a player by email. They take a confirmed seat right away, with no entry payment in the app; any fee is yours to settle with them."
      input={
        <Field>
          <FieldLabel htmlFor="enroll-player-email">Email</FieldLabel>
          <Input
            id="enroll-player-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jordan@example.com"
            autoComplete="off"
            disabled={busy}
            required
          />
          <FieldDescription>
            The entry shows as awaiting player details until the player opens
            the app signed in with this email and a name, or until you name them
            with &ldquo;Continue as guest&rdquo;. Play can&apos;t start while an
            entrant has no name.
          </FieldDescription>
        </Field>
      }
      submitLabel="Enroll player"
      busy={busy}
      onSubmit={handleSubmit}
    />
  )
}

// "Add guest": seat a player by name. No email, no account, ready to play.
export function AddGuestDialog({
  tournament,
}: {
  tournament: Doc<'tournaments'> | undefined
}) {
  const addGuest = useMutation(api.tournaments.registrations.addGuest)
  const [open, setOpen] = useState(false)
  const { busy, run } = useBusyAction()
  const [displayName, setDisplayName] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tournament) {
      return
    }
    await run(async () => {
      await addGuest({ tournamentId: tournament._id, displayName })
      toast.success(`${displayName.trim()} has been added as a guest.`)
      setDisplayName('')
      setOpen(false)
    }, 'Could not add guest.')
  }

  return (
    <SingleFieldDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          type="button"
          variant="outline"
          disabled={!canEnroll(tournament)}
        >
          <UserRoundPlus data-icon="inline-start" />
          Add guest
        </Button>
      }
      title="Add a guest"
      description="Seat a player by name alone. They take a confirmed seat right away and need no email or account; any fee is yours to settle with them."
      input={
        <Field>
          <FieldLabel htmlFor="add-guest-name">Name</FieldLabel>
          <Input
            id="add-guest-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Jordan Lee"
            maxLength={ENROLLMENT_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={busy}
            required
          />
          <FieldDescription>
            Shown on pairings and standings for this event. Guests report
            through you or their opponent.
          </FieldDescription>
        </Field>
      }
      submitLabel="Add guest"
      busy={busy}
      onSubmit={handleSubmit}
    />
  )
}

// "Continue as guest": name an entry awaiting player details, for this event.
// Controlled by the caller (a dropdown item or a list row opens it), since a
// menu item unmounts on select.
export function ContinueAsGuestDialog({
  open,
  onOpenChange,
  registrationId,
  // What the entry is labelled by now — the enrollment email for an
  // organizer-only dialog — so the organizer knows who they are naming.
  currentLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  registrationId: Id<'tournamentRegistrations'>
  currentLabel: string
}) {
  const continueAsGuest = useMutation(
    api.tournaments.registrations.continueAsGuest,
  )
  const { busy, run } = useBusyAction()
  const [displayName, setDisplayName] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await continueAsGuest({ registrationId, displayName })
      toast.success(`${currentLabel} will play as ${displayName.trim()}.`)
      setDisplayName('')
      onOpenChange(false)
    }, 'Could not name player.')
  }

  return (
    <SingleFieldDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Continue ${currentLabel} as a guest`}
      description="Give this entry its name for this event. The seat, history, and fee treatment stay as they are, and the email stays on file so the player can still claim the entry by signing in later."
      input={
        <Field>
          <FieldLabel htmlFor="continue-as-guest-name">Name</FieldLabel>
          <Input
            id="continue-as-guest-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Jordan Lee"
            maxLength={ENROLLMENT_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={busy}
            required
          />
          <FieldDescription>
            Shown on pairings and standings for this event only. If the player
            later signs in, this name stays; their other events are not renamed.
          </FieldDescription>
        </Field>
      }
      submitLabel="Continue as guest"
      busy={busy}
      onSubmit={handleSubmit}
    />
  )
}

// The icon the roster menu and the overview list share for the action.
export const ContinueAsGuestIcon = UserPen
