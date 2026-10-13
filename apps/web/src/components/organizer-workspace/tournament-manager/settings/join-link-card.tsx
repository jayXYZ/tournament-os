import { useMutation, useQuery } from 'convex/react'
import { Copy, Link2, Link2Off, QrCodeIcon, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { JoinQrDialog } from '../join-qr-dialog'
import { joinUrl } from '../join-link'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { SectionHeader } from '@/components/shared/section-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

// The settings card for sharing the event, which follows its visibility. A
// public or unlisted event shares its join link, built on the stable public
// code; a private event shares its invite link instead (CONTEXT.md "Invite
// Link"), the one card where minting, rotating, and disabling it live.
export function JoinLinkCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  return tournament.visibility === 'private' ? (
    <InviteLinkSection tournament={tournament} />
  ) : (
    <PublicJoinLinkSection tournament={tournament} />
  )
}

function PublicJoinLinkSection({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const url = joinUrl(tournament.publicCode)
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Join link"
        description="Anyone with this link (or the event's code) can open the event page and register. It never changes, so printed copies keep working. Making the event private is how you stop it admitting anyone."
      />
      <div className="flex flex-wrap items-center gap-2">
        <LinkField label="Join link" value={url} />
        <CopyLinkButton url={url} copiedMessage="Join link copied." />
        <ShowQrButton tournament={tournament} />
      </div>
      <UnpublishedNote tournament={tournament} />
    </section>
  )
}

function InviteLinkSection({ tournament }: { tournament: Doc<'tournaments'> }) {
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

  async function handleCreate() {
    await run(async () => {
      await regenerateInviteLink({ tournamentId: tournament._id })
      toast.success('Invite link created.')
    }, 'Could not create an invite link.')
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Invite link"
        description="Anyone with the link (or its code) can view this event and register, even while the event is private — it's how you let players into an invite-only event. Regenerating or disabling it kills every previously shared link."
      />
      <div>
        {invite ? (
          <div className="flex flex-wrap items-center gap-2">
            <LinkField label="Invite link" value={joinUrl(invite.code)} />
            <CopyLinkButton
              url={joinUrl(invite.code)}
              copiedMessage="Invite link copied."
            />
            <ShowQrButton tournament={tournament} />
            {/* Rotation is the only way to revoke an invite, and it kills
                every shared and printed copy at once, so neither action runs
                on a single click. */}
            <ConfirmActionDialog
              trigger={
                <Button type="button" variant="outline" disabled={disabled}>
                  <RefreshCw data-icon="inline-start" />
                  Regenerate
                </Button>
              }
              icon={<RefreshCw />}
              title="Regenerate the invite link?"
              description="The current link stops working, along with every copy you've shared and every printed QR code. Players it already admitted keep their spots."
              actionLabel="Regenerate"
              failureMessage="Could not create an invite link."
              onConfirm={async () => {
                await regenerateInviteLink({ tournamentId: tournament._id })
                toast.success(
                  'New invite link created. Previously shared links no longer work.',
                )
              }}
            />
            <ConfirmActionDialog
              trigger={
                <Button type="button" variant="outline" disabled={disabled}>
                  <Link2Off data-icon="inline-start" />
                  Disable
                </Button>
              }
              icon={<Link2Off />}
              destructive
              title="Disable the invite link?"
              description="The link stops working, along with every copy you've shared and every printed QR code, and nobody new can join this private event until you create another. Players it already admitted keep their spots."
              actionLabel="Disable link"
              failureMessage="Could not disable the invite link."
              onConfirm={async () => {
                await disableInviteLink({ tournamentId: tournament._id })
                toast.success(
                  'Invite link disabled. Players it already admitted keep their spots.',
                )
              }}
            />
          </div>
        ) : (
          <Button type="button" disabled={disabled} onClick={handleCreate}>
            {busy ? <Spinner /> : <Link2 data-icon="inline-start" />}
            Create invite link
          </Button>
        )}
      </div>
      {invite ? <UnpublishedNote tournament={tournament} /> : null}
    </section>
  )
}

function LinkField({ label, value }: { label: string; value: string }) {
  return (
    <Input
      readOnly
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      aria-label={label}
      className="max-w-md font-mono text-sm"
    />
  )
}

function CopyLinkButton({
  url,
  copiedMessage,
}: {
  url: string
  copiedMessage: string
}) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(copiedMessage)
    } catch {
      toast.error('Could not copy the link — copy it from the field instead.')
    }
  }
  return (
    <Button type="button" variant="outline" onClick={handleCopy}>
      <Copy data-icon="inline-start" />
      Copy
    </Button>
  )
}

// Always enabled, whatever the lifecycle: the dialog itself explains why an
// unpublished or closed event has no code to show.
function ShowQrButton({ tournament }: { tournament: Doc<'tournaments'> }) {
  return (
    <JoinQrDialog
      tournament={tournament}
      trigger={
        <Button type="button" variant="outline">
          <QrCodeIcon data-icon="inline-start" />
          Show QR code
        </Button>
      }
    />
  )
}

// Either link can be copied before publication, but it opens nothing until
// then (resolveJoinCode treats a setup event as unknown).
function UnpublishedNote({ tournament }: { tournament: Doc<'tournaments'> }) {
  if (tournament.lifecycle !== 'setup') {
    return null
  }
  return (
    <p className="text-xs text-muted-foreground">
      The link starts working once you publish the event.
    </p>
  )
}
