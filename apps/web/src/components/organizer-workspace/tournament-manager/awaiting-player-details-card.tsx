import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { UserMinus } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { toast } from 'sonner'
import {
  ContinueAsGuestDialog,
  ContinueAsGuestIcon,
} from './enrollment-dialogs'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PairingsBoard } from './pairings-board'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { SectionHeader } from '@/components/shared/section-header'
import { Button } from '@/components/ui/button'

// The entrants holding the start (CONTEXT.md "Awaiting Player Details"):
// entries enrolled by email that nobody has named yet. The board lists them
// with the three ways to resolve each — the player opens the app signed in
// with that email, the organizer names them here, or the organizer removes
// the entry (the ordinary pre-start drop) —
// so the blocked start never leaves the organizer hunting through the
// roster. Organizer-only: each entry is identified by its email.
export function AwaitingPlayerDetailsCard({
  entrants,
  publicCode,
}: {
  entrants: PairingsBoard['playersAwaitingDetails']
  publicCode: string
}) {
  if (entrants.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={`${entrants.length} ${entrants.length === 1 ? 'player is' : 'players are'} awaiting player details`}
        description={
          <>
            Each needs a name before pairings or seats can be drawn: the player
            can open the app signed in with their email, or you can name them
            here. Entries you remove free their seat.{' '}
            <Link
              to="/admin/tournaments/$tournamentId/registrations"
              params={{ tournamentId: publicCode }}
              className="underline underline-offset-4"
            >
              Registrations
            </Link>
          </>
        }
      />
      <ul className="divide-y divide-border rounded-md border border-border">
        {entrants.map((entrant) => (
          <AwaitingEntrantRow key={entrant.registrationId} entrant={entrant} />
        ))}
      </ul>
    </section>
  )
}

function AwaitingEntrantRow({
  entrant,
}: {
  entrant: PairingsBoard['playersAwaitingDetails'][number]
}) {
  const dropRegistration = useMutation(
    api.tournaments.registrations.dropRegistration,
  )
  const [naming, setNaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const label = entrant.label ?? 'Unnamed entry'
  const registrationId: Id<'tournamentRegistrations'> = entrant.registrationId

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setNaming(true)}
        >
          <ContinueAsGuestIcon data-icon="inline-start" />
          Continue as guest
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${label}`}
          onClick={() => setRemoving(true)}
        >
          <UserMinus />
        </Button>
      </span>
      <ContinueAsGuestDialog
        open={naming}
        onOpenChange={setNaming}
        registrationId={registrationId}
        currentLabel={label}
      />
      <ConfirmActionDialog
        open={removing}
        onOpenChange={setRemoving}
        icon={<UserMinus />}
        destructive
        title={`Remove ${label}?`}
        description="Their entry will be cancelled and their seat freed. They can be enrolled again later."
        actionLabel="Remove entry"
        failureMessage="Could not remove entry."
        onConfirm={async () => {
          await dropRegistration({ registrationId })
          toast.success(`${label}'s entry has been removed.`)
        }}
      />
    </li>
  )
}
