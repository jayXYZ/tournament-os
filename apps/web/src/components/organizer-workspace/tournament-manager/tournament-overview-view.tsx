import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { ExternalLink } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import {
  DEFAULT_ROUND_DURATION_MS,
  formatTimer,
} from '@paper-pairings/shared/timer-utils'
import { DEFAULT_BEST_OF } from '@paper-pairings/shared/match-structure'
import { useOrganization } from '../organization-context'
import { describeCurrentRound, describeNextStep } from './next-step'
import {
  OutstandingTablesCard,
  UnconfirmedResultsCard,
} from './overview-ledger'
import { RecentActivityCard } from './overview-activity'
import { inProgressRound } from './pairings-board'
import { phaseLabel } from './phase-label'
import { useManagedTournament } from './tournament-manager-context'
import { TournamentProgressBar } from './tournament-progress-bar'
import type { ReactNode } from 'react'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PairingsBoard } from './pairings-board'
import type { OverviewBody } from './next-step'
import {
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
  formatTournamentDateLong,
} from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// The organizer's answer to "where are we?": the event's name, the live
// status band with the one next action, the timeline, then what needs doing
// in the current round. The public event page is one link away; it no
// longer occupies the working area.
export function TournamentOverviewView({
  tournamentId,
  publicCode,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
}) {
  const { tournament } = useManagedTournament()
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  })

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {tournament.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <TournamentLifecycleBadge lifecycle={tournament.lifecycle} />
            <span className="capitalize">{tournament.format}</span>
            {board ? <span>{describeShape(board)}</span> : null}
            {board ? <span>{describeField(board)}</span> : null}
            <TournamentVisibilityBadge visibility={tournament.visibility} />
          </div>
        </div>
        <Button asChild type="button" variant="outline" className="shrink-0">
          <Link
            to="/tournaments/$tournamentId"
            params={{ tournamentId: publicCode }}
            target="_blank"
            rel="noreferrer"
          >
            View public page
            <ExternalLink data-icon="inline-end" />
          </Link>
        </Button>
      </header>

      <TournamentProgressBar
        tournamentId={tournamentId}
        publicCode={publicCode}
        density="expanded"
      />

      {board ? (
        <OverviewBody board={board} publicCode={publicCode} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      <EventDetails board={board} />
    </section>
  )
}

function OverviewBody({
  board,
  publicCode,
}: {
  board: PairingsBoard
  publicCode: string
}) {
  const description = describeNextStep(board)
  const round = inProgressRound(board)
  const phaseBoard = round
    ? board.phases.find(
        (candidate) => candidate.phase._id === round.tournamentPhaseId,
      )
    : undefined
  const bestOf = phaseBoard?.phase.bestOf ?? DEFAULT_BEST_OF
  const tournamentId = board.tournament._id

  const liveRound =
    round &&
    (description.body === 'live' || description.body === 'unpublished-pairings')
      ? round
      : null

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1.55fr_1fr]">
      {liveRound ? (
        <OutstandingTablesCard
          roundId={liveRound._id}
          roundLabel={describeCurrentRound(board)}
          bestOf={bestOf}
          publicCode={publicCode}
        />
      ) : (
        <StateCard
          body={description.body}
          board={board}
          publicCode={publicCode}
        />
      )}
      <div className="flex flex-col gap-4">
        {liveRound ? (
          <UnconfirmedResultsCard roundId={liveRound._id} bestOf={bestOf} />
        ) : null}
        <RecentActivityCard
          tournamentId={tournamentId}
          publicCode={publicCode}
        />
      </div>
    </div>
  )
}

// What the body says when there is no round to list, in the same voice as
// the band: the actual condition and the place to act on it.
function StateCard({
  body,
  board,
  publicCode,
}: {
  body: OverviewBody
  board: PairingsBoard
  publicCode: string
}) {
  const { field, tournament } = board
  const params = { tournamentId: publicCode }
  let title: string
  let text: string
  let action: ReactNode = null

  switch (body) {
    case 'setup':
      title = 'Not published yet'
      text =
        'Only your team can see this event. Publishing opens registration to players; check the phases, dates, and entry fee first.'
      action = (
        <Button asChild type="button" variant="outline">
          <Link to="/admin/tournaments/$tournamentId/settings" params={params}>
            Event settings
          </Link>
        </Button>
      )
      break
    case 'registration':
      title = `${field.confirmed} of ${tournament.playerCapacity} registered`
      text =
        field.confirmed < 2
          ? 'At least two players are needed to pair round 1.'
          : 'Approvals, waitlist, and decklists live in Registrations. Generate pairings when the field is set.'
      action = (
        <Button asChild type="button" variant="outline">
          <Link
            to="/admin/tournaments/$tournamentId/registrations"
            params={params}
          >
            Registrations
          </Link>
        </Button>
      )
      break
    case 'between-rounds':
      title = `${describeCurrentRound(board)} complete`
      text =
        'Standings are posted. Generate the next round when the room is ready; drops made now are reflected in the new pairings.'
      action = (
        <Button asChild type="button" variant="outline">
          <Link to="/admin/tournaments/$tournamentId/standings" params={params}>
            Standings
          </Link>
        </Button>
      )
      break
    case 'finished':
      title = 'Tournament complete'
      text = 'Final standings are posted and the event is closed.'
      action = (
        <Button asChild type="button" variant="outline">
          <Link to="/admin/tournaments/$tournamentId/standings" params={params}>
            Final standings
          </Link>
        </Button>
      )
      break
    case 'cancelled':
      title = 'Tournament cancelled'
      text = 'Refunds and payment outcomes are recorded in Activity.'
      break
    case 'live':
    case 'unpublished-pairings':
      // Handled by the ledger; kept exhaustive for the switch.
      title = describeCurrentRound(board)
      text = ''
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {text ? <CardDescription>{text}</CardDescription> : null}
      </CardHeader>
      {action ? <CardContent>{action}</CardContent> : null}
    </Card>
  )
}

// "Swiss, 5 rounds, then Top 8"
function describeShape(board: PairingsBoard) {
  return board.phases
    .map((phaseBoard, index) => {
      const label = phaseLabel(
        phaseBoard.phase,
        index > 0 ? board.phases[index - 1].phase : undefined,
      )
      const planned = phaseBoard.timeline.plannedRoundCount
      return planned === null
        ? label
        : `${label}, ${planned} ${planned === 1 ? 'round' : 'rounds'}`
    })
    .join(', then ')
}

// Who is playing, not who registered: "31 playing, 1 dropped" during the
// event; registration against capacity before it.
function describeField(board: PairingsBoard) {
  const { field, tournament } = board
  if (tournament.lifecycle !== 'in_progress') {
    return `${field.confirmed} of ${tournament.playerCapacity} registered`
  }
  const departures = field.dropped + field.eliminated + field.disqualified
  return departures === 0
    ? `${field.active} playing`
    : `${field.active} playing, ${departures} out`
}

// Scheduled date, host, capacity, and fee: true and secondary during play,
// stated once each.
function EventDetails({ board }: { board: PairingsBoard | undefined }) {
  const { tournament } = useManagedTournament()
  const { organizations } = useOrganization()
  const organizationName = organizations?.find(
    (row) => row.organization._id === tournament.organizationId,
  )?.organization.name
  const firstPhase = board?.phases.at(0)?.phase

  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
      <Detail label="Starts">
        {formatTournamentDateLong(tournament.startDate)}
      </Detail>
      <Detail label="Registered">
        {tournament.confirmedRegistrationCount} of {tournament.playerCapacity}
      </Detail>
      {organizationName ? (
        <Detail label="Hosted by">{organizationName}</Detail>
      ) : null}
      <Detail label="Entry">
        {tournament.entryFeeCents
          ? formatCents(tournament.entryFeeCents)
          : 'Free'}
      </Detail>
      {firstPhase ? (
        <Detail label="Matches">Best of {firstPhase.bestOf}</Detail>
      ) : null}
      <Detail label="Round length">
        {formatTimer(tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS)}
      </Detail>
      {tournament.isTestEvent ? <Detail label="Test event">Yes</Detail> : null}
    </dl>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  )
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}
