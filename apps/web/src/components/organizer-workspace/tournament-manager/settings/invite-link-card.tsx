import { useMutation, useQuery } from 'convex/react'
import { Copy, Link2, Link2Off, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

// The path half of the /join URL. The full link needs window.location.origin,
// which SSR lacks — but the code only arrives through the client-side invite
// query, so the path-only fallback below is unreachable in practice.
function joinPath(code: string) {
  return `/join/${code}`
}

export function InviteLinkCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const invite = useQuery(api.tournaments.invites.getInviteLink, {
    tournamentId: tournament._id,
  })
  const regenerateInviteLink = useMutation(
    api.tournaments.invites.regenerateInviteLink,
  )
  const disableInviteLink = useMutation(
    api.tournaments.invites.disableInviteLink,
  )
  const { busy, run } = useBusyAction()
  const disabled =
    busy || invite === undefined || tournament.lifecycle === 'cancelled'

  const inviteUrl =
    invite && typeof window !== 'undefined'
      ? `${window.location.origin}${joinPath(invite.code)}`
      : null

  async function handleCopy() {
    if (!inviteUrl) {
      return
    }
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.success('Invite link copied.')
    } catch {
      toast.error('Could not copy the link — copy it from the field instead.')
    }
  }

  async function handleRegenerate() {
    await run(async () => {
      await regenerateInviteLink({ tournamentId: tournament._id })
      toast.success(
        invite
          ? 'New invite link created. Previously shared links no longer work.'
          : 'Invite link created.',
      )
    }, 'Could not create an invite link.')
  }

  async function handleDisable() {
    await run(async () => {
      await disableInviteLink({ tournamentId: tournament._id })
      toast.success(
        'Invite link disabled. Players it already admitted keep their spots.',
      )
    }, 'Could not disable the invite link.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite link</CardTitle>
        <CardDescription>
          Anyone with the link (or its code) can view this event and register,
          even while the event is private — it&apos;s how you let players into
          an invite-only event. Regenerating or disabling it kills every
          previously shared link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={inviteUrl ?? joinPath(invite.code)}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Invite link"
              className="max-w-md font-mono text-sm"
            />
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy data-icon="inline-start" />
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={handleRegenerate}
            >
              {busy ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
              Regenerate
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={handleDisable}
            >
              <Link2Off data-icon="inline-start" />
              Disable
            </Button>
          </div>
        ) : (
          <Button type="button" disabled={disabled} onClick={handleRegenerate}>
            {busy ? <Spinner /> : <Link2 data-icon="inline-start" />}
            Create invite link
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
