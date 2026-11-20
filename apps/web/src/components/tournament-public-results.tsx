import { useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { ChevronLeft, ChevronRight, ListOrdered, Swords } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import type { FunctionReturnType } from 'convex/server'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'
import type { ScoreSlip } from '@/components/shared/score-slip'
import {
  ScoreSlipPlayers,
  ScoreSlipResult,
  ScoreSlipTable,
} from '@/components/shared/score-slip'
import { SectionHeader } from '@/components/shared/section-header'
import { StandingsRows } from '@/components/shared/standings-rows'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type Lifecycle = Doc<'tournaments'>['lifecycle']
type PublicMatches = NonNullable<
  FunctionReturnType<typeof api.tournaments.publicResults.getPublicMatches>
>
type PublicRound = PublicMatches['phases'][number]['rounds'][number] & {
  phaseName: string
  phaseCount: number
}

// Public Results (CONTEXT.md) on the event page: the released rounds'
// matches and the latest standings, for every viewer the page itself admits.
// Both read reactive queries, so a result the organizer enters or a round
// they complete shows here without a reload. The queries take the page's
// public code and invite code and apply the page's own access rule
// server-side; nothing here decides who may see what.
export function TournamentPublicResults({
  publicCode,
  inviteCode,
  lifecycle,
}: {
  publicCode: string
  inviteCode?: string
  lifecycle: Lifecycle
}) {
  // undefined follows the latest released round as new ones come out; a
  // round the viewer picked stays picked. Lifted above the tabs so moving
  // between them keeps the choice.
  const [roundId, setRoundId] = useState<Id<'tournamentRounds'> | undefined>()

  if (lifecycle === 'setup' || lifecycle === 'registration') {
    return (
      <TableEmptyState
        icon={Swords}
        title="Pairings and standings"
        description="They appear here once the event begins, and update live as results come in."
        className="min-h-40"
      />
    )
  }

  return (
    <section aria-label="Pairings and standings">
      <Tabs
        defaultValue={lifecycle === 'in_progress' ? 'matches' : 'standings'}
      >
        <TabsList className="w-fit">
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
        </TabsList>
        <TabsContent value="matches">
          <PublicMatchesView
            publicCode={publicCode}
            inviteCode={inviteCode}
            roundId={roundId}
            onSelectRound={setRoundId}
            cancelled={lifecycle === 'cancelled'}
          />
        </TabsContent>
        <TabsContent value="standings">
          <PublicStandingsView
            publicCode={publicCode}
            inviteCode={inviteCode}
            final={lifecycle === 'completed'}
            cancelled={lifecycle === 'cancelled'}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}

function PublicStandingsView({
  publicCode,
  inviteCode,
  final,
  cancelled,
}: {
  publicCode: string
  inviteCode?: string
  final: boolean
  cancelled: boolean
}) {
  const result = useQuery(api.tournaments.publicResults.getPublicStandings, {
    publicCode,
    inviteCode,
  })

  if (result === undefined) {
    return <Skeleton className="h-56" />
  }
  // Null only when the page's own query would refuse the viewer too; the
  // page shows that state, so this section stays empty.
  if (result === null) {
    return null
  }
  const { standings } = result
  if (standings === null) {
    return (
      <TableEmptyState
        icon={ListOrdered}
        title={cancelled ? 'No standings' : 'No standings yet'}
        description={
          // A cancelled event will never post any, so it must not promise them.
          cancelled
            ? 'The event was cancelled before a round was completed.'
            : 'Standings appear after the first round is completed.'
        }
        className="min-h-48"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        title={final ? 'Final standings' : 'Standings'}
        description={`After ${standings.roundName}`}
      />
      <StandingsRows rows={standings.rows} />
    </div>
  )
}

function PublicMatchesView({
  publicCode,
  inviteCode,
  roundId,
  onSelectRound,
  cancelled,
}: {
  publicCode: string
  inviteCode?: string
  roundId: Id<'tournamentRounds'> | undefined
  onSelectRound: (roundId: Id<'tournamentRounds'> | undefined) => void
  cancelled: boolean
}) {
  const live = useQuery(api.tournaments.publicResults.getPublicMatches, {
    publicCode,
    inviteCode,
    roundId,
  })
  // Convex answers undefined while a changed round argument loads; holding
  // the previous round's matches keeps the list (and the viewer's place on
  // the page) steady through the switch. The event page remounts this view
  // per public code, so one event's matches never stand in for another's.
  const held = useRef<PublicMatches | null | undefined>(undefined)
  if (live !== undefined) {
    held.current = live
  }
  const result = live ?? held.current
  const [filter, setFilter] = useState('')

  if (result === undefined) {
    return <Skeleton className="h-56" />
  }
  if (result === null) {
    return null
  }
  if (result.round === null) {
    return (
      <TableEmptyState
        icon={Swords}
        title={cancelled ? 'No pairings' : 'No pairings yet'}
        description={
          cancelled
            ? 'The event was cancelled before any pairings were released.'
            : 'Pairings appear here as soon as the organizer releases them.'
        }
        className="min-h-48"
      />
    )
  }

  const current = result.round
  const rounds: Array<PublicRound> = result.phases.flatMap((phase) =>
    phase.rounds.map((round) => ({
      ...round,
      phaseName: phase.phaseName,
      phaseCount: result.phases.length,
    })),
  )
  const selectedIndex = rounds.findIndex(
    (round) => round.roundId === current.roundId,
  )
  const previous = selectedIndex > 0 ? rounds[selectedIndex - 1] : undefined
  const next =
    selectedIndex >= 0 && selectedIndex < rounds.length - 1
      ? rounds[selectedIndex + 1]
      : undefined
  // Stepping onto the newest round goes back to following the latest one.
  const select = (round: PublicRound) =>
    onSelectRound(
      round.roundId === rounds.at(-1)?.roundId ? undefined : round.roundId,
    )
  const selected = rounds.at(selectedIndex)

  const needle = filter.trim().toLowerCase()
  const matches = needle
    ? result.matches.filter((match) =>
        match.players.some((player) =>
          displayPlayerName(player.name).toLowerCase().includes(needle),
        ),
      )
    : result.matches

  return (
    <div
      className={cn(
        'flex flex-col gap-3 transition-opacity',
        live === undefined && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous round"
          disabled={!previous}
          onClick={() => previous && select(previous)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {/* Polite, so stepping between rounds is announced to a screen reader. */}
        <div className="min-w-0" aria-live="polite">
          <h2 className="text-sm font-medium">
            {current.roundName}
            {selected && selected.phaseCount > 1 ? (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {selected.phaseName}
              </span>
            ) : null}
          </h2>
          <p className="text-xs/relaxed text-muted-foreground">
            {selectedIndex + 1} of {rounds.length}{' '}
            {rounds.length === 1 ? 'round' : 'rounds'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next round"
          disabled={!next}
          onClick={() => next && select(next)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <RoundStatusBadge status={current.roundStatus} cancelled={cancelled} />
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a player"
          aria-label="Find a player"
          className="ml-auto h-8 w-full sm:w-48"
        />
      </div>
      {matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No players match your search.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {matches.map((match) => (
            <MatchRow key={match.matchId} match={match} cancelled={cancelled} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RoundStatusBadge({
  status,
  cancelled,
}: {
  status: PublicMatches['phases'][number]['rounds'][number]['roundStatus']
  cancelled: boolean
}) {
  if (status === 'completed') {
    return <Badge variant="secondary">Finished</Badge>
  }
  if (cancelled || status === 'cancelled') {
    return <Badge variant="outline">Not finished</Badge>
  }
  return <Badge>In progress</Badge>
}

function MatchRow({
  match,
  cancelled,
}: {
  match: ScoreSlip
  cancelled: boolean
}) {
  return (
    // Names first, whole: on a phone the result drops under them rather
    // than truncating them, since a name is what a visitor scans for.
    <li className="flex items-start gap-3 px-3 py-2.5 text-sm sm:items-center">
      <span className="w-8 shrink-0 text-right">
        <ScoreSlipTable row={match} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="min-w-0 break-words">
          <ScoreSlipPlayers row={match} layout="inline" />
        </span>
        <ScoreSlipResult
          row={match}
          className="shrink-0"
          pendingLabel={cancelled ? 'Not played' : 'Awaiting'}
        />
      </div>
    </li>
  )
}
