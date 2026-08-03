import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  ChevronLeft,
  LogIn,
  ScrollText,
  SearchX,
  UserRound,
} from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { DecklistEditor } from './decklist-editor'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useAppAuth } from '@/lib/use-app-auth'

// The player's decklist submission page, reached from the player controller.
// Access mirrors the controller: public code resolves the event, then a
// signed-in viewer with a confirmed registration gets the editor. The editor
// itself decides between editable and read-only from the server's
// submissionOpen verdict.
export function DecklistPage({ publicCode }: { publicCode: string }) {
  const { user, loading, refreshAuth } = useAppAuth()
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  })
  const typedTournamentId = event?.tournament._id ?? null
  const registration = useQuery(
    api.tournaments.registrations.getMyRegistration,
    user && typedTournamentId ? { tournamentId: typedTournamentId } : 'skip',
  )
  const hasConfirmedEntry = registration?.entryStatus === 'confirmed'
  // Fetched even when the tournament no longer collects decklists: the
  // organizer settings copy promises "Turning this off keeps any submitted
  // lists", and getMyDecklist has no decklistRequired gate — it returns the
  // stored list with submissionOpen: false, so the player can still view it.
  const decklistData = useQuery(
    api.tournaments.decklists.getMyDecklist,
    user && typedTournamentId && hasConfirmedEntry
      ? { tournamentId: typedTournamentId }
      : 'skip',
  )
  // Whether the mounted editor holds unsaved changes, reported live via
  // onDirtyChange. The no-decklist-needed gate below checks it so flipping
  // decklistRequired off mid-edit never unmounts a dirty editor and silently
  // destroys the draft.
  const [editorDirty, setEditorDirty] = useState(false)

  if (loading || event === undefined) {
    return (
      <DecklistFrame publicCode={publicCode}>
        <div className="flex min-h-60 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </DecklistFrame>
    )
  }

  if (event === null || typedTournamentId === null) {
    return (
      <DecklistFrame publicCode={publicCode}>
        <Empty className="mt-4 min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Tournament not found</EmptyTitle>
            <EmptyDescription>
              This event does not exist or is not open to the public.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link to="/">Browse upcoming tournaments</Link>
          </Button>
        </Empty>
      </DecklistFrame>
    )
  }

  if (!user) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <Empty className="mt-4 min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRound aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Sign in to manage your decklist</EmptyTitle>
            <EmptyDescription>
              Sign in to submit and edit the decklist for your registration.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
          >
            <LogIn data-icon="inline-start" />
            Sign in
          </Button>
        </Empty>
      </DecklistFrame>
    )
  }

  if (registration === undefined) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <div className="grid gap-3 pt-4">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24" />
          ))}
        </div>
      </DecklistFrame>
    )
  }

  if (!hasConfirmedEntry) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <Empty className="mt-4 min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>You are not registered</EmptyTitle>
            <EmptyDescription>
              Only players with a confirmed registration can submit a decklist
              for this event.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link
              to="/tournaments/$tournamentId"
              params={{ tournamentId: publicCode }}
            >
              View event page
            </Link>
          </Button>
        </Empty>
      </DecklistFrame>
    )
  }

  if (decklistData === undefined || decklistData === null) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <div className="grid gap-3 pt-4">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24" />
          ))}
        </div>
      </DecklistFrame>
    )
  }

  // "No decklist needed" only when there is truly nothing to show: an event
  // that stopped collecting decklists keeps a submitted list viewable (the
  // editor renders it read-only from submissionOpen: false), and a dirty
  // editor stays mounted so an in-progress draft survives the flag flipping.
  if (
    !event.tournament.decklistRequired &&
    decklistData.decklist === null &&
    !editorDirty
  ) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <Empty className="mt-4 min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No decklist needed</EmptyTitle>
            <EmptyDescription>
              This event does not collect decklists. You are all set — just show
              up and play.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link
              to="/tournaments/$tournamentId/play"
              params={{ tournamentId: publicCode }}
            >
              Back to player controller
            </Link>
          </Button>
        </Empty>
      </DecklistFrame>
    )
  }

  return (
    <DecklistEditor
      tournamentId={typedTournamentId}
      data={decklistData}
      onDirtyChange={setEditorDirty}
    >
      {(editor, submitBar) => (
        <DecklistFrame
          publicCode={publicCode}
          eventName={event.tournament.name}
          bottomBar={submitBar}
        >
          {editor}
        </DecklistFrame>
      )}
    </DecklistEditor>
  )
}

// The editor is a single-column form, so it — and the submit bar pinned
// under it — stays at a comfortable reading width and centers inside the
// wider site chrome.
const formColumnClasses = 'lg:mx-auto lg:w-full lg:max-w-2xl'

function DecklistFrame({
  publicCode,
  eventName,
  bottomBar,
  children,
}: {
  publicCode: string
  eventName?: string
  bottomBar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SiteShell
      subtitle="Decklist"
      toaster
      bottomBar={
        bottomBar ? (
          <div className={formColumnClasses}>{bottomBar}</div>
        ) : undefined
      }
      actions={
        <SiteShellBackLink
          to="/tournaments/$tournamentId/play"
          params={{ tournamentId: publicCode }}
        >
          Player controller
        </SiteShellBackLink>
      }
      appBar={
        <div className="flex items-center gap-2">
          <Button asChild type="button" variant="ghost" size="icon">
            <Link
              to="/tournaments/$tournamentId/play"
              params={{ tournamentId: publicCode }}
              aria-label="Back to player controller"
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Decklist</p>
            {eventName ? (
              <p className="truncate text-xs text-muted-foreground">
                {eventName}
              </p>
            ) : null}
          </div>
        </div>
      }
    >
      <div className={formColumnClasses}>
        {eventName ? (
          <div className="hidden pt-8 lg:block">
            <WorkspacePageHeader eyebrow="Decklist" title={eventName} />
          </div>
        ) : null}
        {children}
      </div>
    </SiteShell>
  )
}
