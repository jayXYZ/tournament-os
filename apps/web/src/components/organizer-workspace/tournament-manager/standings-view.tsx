import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Trophy } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type StandingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundStandings
>[number]

export function StandingsView({ tournamentId }: { tournamentId: string }) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(
    null,
  )

  const phases = board?.phases ?? []
  const defaultPhase =
    phases.find(({ phase }) => phase.phaseStatus === 'in_progress') ?? phases[0]
  const activePhase =
    phases.find(({ phase }) => phase._id === selectedPhaseId) ?? defaultPhase
  const rounds = activePhase?.rounds ?? []
  const completedRounds = rounds.filter(
    (round) => round.roundStatus === 'completed',
  )
  const latestCompletedRound = completedRounds[completedRounds.length - 1]
  const selectedRound =
    completedRounds.find(
      (round) => round.roundNumber === selectedRoundNumber,
    ) ?? latestCompletedRound
  const roundTabCount = Math.max(
    activePhase?.phase.phaseTotalRounds ?? 0,
    rounds.length,
  )

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Tournament manager
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Standings
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tournament standings</CardTitle>
          <CardDescription>
            Track ranks, match points, and tiebreakers across rounds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {board === undefined ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12" />
              ))}
            </div>
          ) : (
            <>
              {phases.length > 1 && activePhase ? (
                <Tabs
                  value={activePhase.phase._id}
                  onValueChange={(value) => {
                    setSelectedPhaseId(value)
                    setSelectedRoundNumber(null)
                  }}
                >
                  <TabsList>
                    {phases.map(({ phase }) => (
                      <TabsTrigger
                        key={phase._id}
                        value={phase._id}
                        disabled={phase.phaseStatus === 'upcoming'}
                      >
                        {phase.phaseName ?? `Phase ${phase.phaseOrder}`}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}

              {!selectedRound ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Trophy />
                    </EmptyMedia>
                    <EmptyTitle>No standings yet</EmptyTitle>
                    <EmptyDescription>
                      Standings are generated when a round is completed. Finish
                      a round to see the leaderboard here.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <Tabs
                    value={String(selectedRound.roundNumber)}
                    onValueChange={(value) =>
                      setSelectedRoundNumber(Number(value))
                    }
                  >
                    <TabsList>
                      {Array.from({ length: roundTabCount }, (_, index) => {
                        const roundNumber = index + 1
                        const hasStandings = completedRounds.some(
                          (round) => round.roundNumber === roundNumber,
                        )
                        return (
                          <TabsTrigger
                            key={roundNumber}
                            value={String(roundNumber)}
                            disabled={!hasStandings}
                          >
                            Round {roundNumber}
                          </TabsTrigger>
                        )
                      })}
                    </TabsList>
                  </Tabs>
                  <StandingsTable roundId={selectedRound._id} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function standingPlayerName(row: StandingRow) {
  return row.user?.name ?? row.user?.email ?? 'Unknown player'
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function StandingsTable({ roundId }: { roundId: Id<'tournamentRounds'> }) {
  const standings = useQuery(api.tournaments.rounds.listRoundStandings, {
    roundId,
  })

  if (standings === undefined) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12" />
        ))}
      </div>
    )
  }

  if (standings.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trophy />
          </EmptyMedia>
          <EmptyTitle>No standings for this round</EmptyTitle>
          <EmptyDescription>
            Standings for this round will appear here once they are generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Rank</TableHead>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead className="text-right">Record</TableHead>
          <TableHead className="text-right">OMW%</TableHead>
          <TableHead className="text-right">GW%</TableHead>
          <TableHead className="text-right">OGW%</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {standings.map((row) => (
          <StandingTableRow key={row.standing._id} row={row} />
        ))}
      </TableBody>
    </Table>
  )
}

function StandingTableRow({ row }: { row: StandingRow }) {
  const { standing } = row

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">
        {standing.rank}
      </TableCell>
      <TableCell>
        <p className="font-medium text-foreground">{standingPlayerName(row)}</p>
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {standing.matchPoints}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {standing.matchWins}&ndash;{standing.matchLosses}&ndash;
        {standing.matchDraws}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatPercent(standing.opponentMatchWinPct)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatPercent(standing.gameWinPct)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {formatPercent(standing.opponentGameWinPct)}
      </TableCell>
    </TableRow>
  )
}
