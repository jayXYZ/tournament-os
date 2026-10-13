import { useMutation, useQuery } from 'convex/react'
import { Download, Link2, Printer } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { formatInviteCode, joinQrCaption, joinUrl } from './join-link'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { ReactNode } from 'react'
import { QR_CODE_OPTIONS, QrCode } from '@/components/shared/qr-code'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

// The event's join QR code (CONTEXT.md "Join QR"), for showing on a screen,
// downloading, or printing. Public and unlisted events encode their public
// code; private events encode the invite link. It follows the live
// tournament document, so flipping the event to private while this is open
// swaps the code for the invite.
//
// It wraps its triggers (JoinQrTrigger, anywhere among the children) rather
// than taking one, so the open dialog outlives them: the share card swaps
// its whole body when visibility changes, trigger included, and the dialog
// has to stay open through that swap to show the new code.
export function JoinQrDialog({
  tournament,
  children,
}: {
  tournament: Doc<'tournaments'>
  children: ReactNode
}) {
  return (
    <Dialog>
      {children}
      {/* Capped to the viewport and scrollable, so a short landscape screen
          or enlarged text never pushes the actions out of reach. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Join QR code</DialogTitle>
          <DialogDescription>{tournament.name}</DialogDescription>
        </DialogHeader>
        <JoinQrBody tournament={tournament} />
      </DialogContent>
    </Dialog>
  )
}

export const JoinQrTrigger = DialogTrigger

function JoinQrBody({ tournament }: { tournament: Doc<'tournaments'> }) {
  // Only an event open for registration gets a code to print. Before
  // publication the code opens nothing, so a printed one would scan as "Code
  // not found" and look broken; once registration closes, registerSelf
  // refuses everyone, so a fresh print would scan to a closed page.
  if (tournament.lifecycle === 'setup') {
    return <JoinQrNote>Publish the event to get a QR code.</JoinQrNote>
  }
  if (tournament.lifecycle !== 'registration') {
    return (
      <JoinQrNote>
        Registration is closed, so there&apos;s nothing to scan.
      </JoinQrNote>
    )
  }
  if (tournament.visibility === 'private') {
    return <PrivateJoinQr tournament={tournament} />
  }
  return (
    <JoinQrSheet
      tournament={tournament}
      code={tournament.publicCode}
      displayCode={tournament.publicCode}
      trustNote="Making the event private stops this code from admitting anyone."
    />
  )
}

// A private event's QR code is its invite link. With no link yet, the dialog
// offers to create one; it never rotates a link that exists, since that
// would kill every copy already shared (rotation lives on the share card,
// behind a confirmation).
function PrivateJoinQr({ tournament }: { tournament: Doc<'tournaments'> }) {
  const invite = useQuery(api.tournaments.invites.getInviteLink, {
    tournamentId: tournament._id,
  })
  const regenerateInviteLink = useMutation(
    api.tournaments.invites.regenerateInviteLink,
  )
  const { busy, run } = useBusyAction()

  if (invite === undefined) {
    return <Skeleton className="mx-auto aspect-square w-full max-w-64" />
  }
  if (invite === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          This event is private, so its QR code is its invite link. Create the
          link to get a code.
        </p>
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await regenerateInviteLink({ tournamentId: tournament._id })
              toast.success('Invite link created.')
            }, 'Could not create an invite link.')
          }
        >
          {busy ? <Spinner /> : <Link2 data-icon="inline-start" />}
          Create invite link
        </Button>
      </div>
    )
  }
  return (
    <JoinQrSheet
      tournament={tournament}
      code={invite.code}
      displayCode={formatInviteCode(invite.code)}
      trustNote="This QR code is the invite. Anyone with a photo of it can join. Regenerate the invite link to cancel it."
    />
  )
}

function JoinQrSheet({
  tournament,
  code,
  displayCode,
  trustNote,
}: {
  tournament: Doc<'tournaments'>
  code: string
  displayCode: string
  trustNote: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const url = joinUrl(code)
  const caption = joinQrCaption(tournament)
  const title = `QR code to join ${tournament.name}`

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error('Could not create the image.')
        return
      }
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `join-${code}.png`
      link.click()
      // The click starts the download synchronously; revoking on the next
      // tick keeps the blob alive until the browser has taken it.
      setTimeout(() => URL.revokeObjectURL(href), 0)
    }, 'image/png')
  }

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <QrCode value={url} title={title} className="max-w-64 rounded-md" />
        <p className="font-medium">{caption}</p>
        <p className="text-muted-foreground">
          Or enter the code{' '}
          <span className="font-mono text-base font-semibold tracking-wider text-foreground">
            {displayCode}
          </span>
        </p>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {url}
        </p>
      </div>
      <p className="text-xs/relaxed text-muted-foreground">{trustNote}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={handleDownload}>
          <Download data-icon="inline-start" />
          Download PNG
        </Button>
        <Button type="button" onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          Print
        </Button>
      </DialogFooter>
      {/* The PNG source: the same code at print resolution, never shown. */}
      <QRCodeCanvas
        {...QR_CODE_OPTIONS}
        ref={canvasRef}
        value={url}
        size={1024}
        className="hidden"
        aria-hidden
      />
      <JoinQrPrintSheet
        name={tournament.name}
        url={url}
        caption={caption}
        displayCode={displayCode}
        title={title}
      />
    </>
  )
}

// What Print puts on paper: the event name, the code, what scanning does,
// and the code to type, nothing else. It sits in <body> so the print rule in
// app.css can hide everything around it, the dialog included. Print preview
// doubles as a full-screen venue display.
function JoinQrPrintSheet({
  name,
  url,
  caption,
  displayCode,
  title,
}: {
  name: string
  url: string
  caption: string
  displayCode: string
  title: string
}) {
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(
    <div
      data-print-sheet
      className="hidden min-h-screen flex-col items-center justify-center gap-8 bg-white p-12 text-center text-black print:flex"
    >
      <h1 className="text-4xl font-semibold text-balance">{name}</h1>
      <QrCode value={url} title={title} className="max-w-[14cm]" />
      <p className="text-2xl">{caption}</p>
      <p className="font-mono text-4xl font-semibold tracking-widest">
        {displayCode}
      </p>
    </div>,
    document.body,
  )
}

function JoinQrNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  )
}
