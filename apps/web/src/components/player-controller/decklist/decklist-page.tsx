import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMyDecklist } from '@tournament-os/core'
import { ChevronLeft, ScrollText } from 'lucide-react'

import {
  PlayerAccessShell,
  PlayerPageSkeleton,
  playerShellWidth,
} from '../player-access-shell'
import { usePlayerTournamentAccess } from '../use-player-tournament-access'
import { DecklistEditor } from './decklist-editor'
import type { PlayerTournamentEvent } from '../use-player-tournament-access'
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

// The player's decklist submission page, reached from the player controller.
// Access mirrors the controller — both pages run the same
// usePlayerTournamentAccess ladder — then the editor itself decides between
// editable and read-only from the server's submissionOpen verdict.
export function DecklistPage({ publicCode }: { publicCode: string }) {
  const access = usePlayerTournamentAccess(publicCode)

  if (access.state !== 'ready') {
    return (
      <DecklistFrame
        publicCode={publicCode}
        eventName={
          access.state === 'notFound'
            ? null
            : access.state === 'loading'
              ? access.event?.tournament.name
              : access.event.tournament.name
        }
      >
        <PlayerAccessShell
          access={access}
          publicCode={publicCode}
          signIn={{
            title: 'Sign in to manage your decklist',
            description:
              'Sign in to submit and edit the decklist for your registration.',
          }}
          notRegistered={{
            icon: ScrollText,
            description:
              'Only players with a confirmed registration can submit a decklist for this event.',
          }}
        />
      </DecklistFrame>
    )
  }

  return <DecklistReady publicCode={publicCode} event={access.event} />
}

// Mounted only in the `ready` access state, so getMyDecklist is subscribed
// only while the viewer holds a confirmed registration.
function DecklistReady({
  publicCode,
  event,
}: {
  publicCode: string
  event: PlayerTournamentEvent
}) {
  const typedTournamentId = event.tournament._id
  // Fetched even when the tournament no longer collects decklists: the
  // organizer settings copy promises "Turning this off keeps any submitted
  // lists", and getMyDecklist has no decklistRequired gate — it returns the
  // stored list with submissionOpen: false, so the player can still view it.
  const decklistData = useMyDecklist(typedTournamentId)
  // Whether the mounted editor holds unsaved changes, reported live via
  // onDirtyChange. The no-decklist-needed gate below checks it so flipping
  // decklistRequired off mid-edit never unmounts a dirty editor and silently
  // destroys the draft.
  const [editorDirty, setEditorDirty] = useState(false)

  if (decklistData === undefined || decklistData === null) {
    return (
      <DecklistFrame publicCode={publicCode} eventName={event.tournament.name}>
        <PlayerPageSkeleton />
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
        <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
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
  // Feeds the desktop heading and the phone app-bar subtitle. Tri-state: a
  // string renders the heading with the name, `undefined` (name still
  // loading) renders the heading shell with a placeholder title so nothing
  // below it shifts when the name arrives, and `null` (tournament not
  // found) omits the heading — matching the controller's not-found state,
  // which shows no heading either.
  eventName?: string | null
  bottomBar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SiteShell
      // playerShellWidth keeps /play and /decklist in lockstep: they share
      // one header rail, and matching tokens keep it from reflowing when
      // navigating between the two pages. Only the frame widens — the form
      // column below caps the content itself at lg:max-w-2xl.
      width={playerShellWidth}
      subtitle="Decklist"
      toaster
      bottomBar={
        bottomBar ? (
          <div className={formColumnClasses}>{bottomBar}</div>
        ) : undefined
      }
      actions={
        // No header action once the code resolved to nothing: there is no
        // player controller for a nonexistent event, so the link would only
        // land on a second not-found screen. `eventName === null` means
        // exactly that (the loading state always passes `undefined`), so one
        // condition drives both this and the heading gate below — mirroring
        // PlayerController's deliberate pop-out in its own not-found state.
        eventName !== null ? (
          <SiteShellBackLink
            to="/tournaments/$tournamentId/play"
            params={{ tournamentId: publicCode }}
          >
            Player controller
          </SiteShellBackLink>
        ) : undefined
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
        {eventName !== null ? (
          <div className="hidden pt-8 lg:block">
            <WorkspacePageHeader
              eyebrow="Decklist"
              title={
                // The placeholder reserves exactly the real title's box:
                // h-9 (2.25rem) equals text-3xl's line height (1.875rem x
                // 1.2), so the h1 keeps its height and the content under
                // the heading holds still when the name lands.
                eventName ?? <Skeleton className="h-9 w-64" />
              }
            />
          </div>
        ) : null}
        {children}
      </div>
    </SiteShell>
  )
}
