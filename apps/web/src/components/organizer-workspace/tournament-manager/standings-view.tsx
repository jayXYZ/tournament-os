import { useQuery } from 'convex/react'
import { Trophy } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { formatPercent, formatRecord } from '@tournament-os/core'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import {
  TournamentPhaseTabs,
  TournamentRoundTabs,
  useTournamentRoundNavigation,
} from '@/components/tournaments'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type StandingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundStandings
>[number]

export function StandingsView({ tournamentId }: { tournamentId: string }) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  const phases = board?.phases ?? []
  const navigation = useTournamentRoundNavigation(phases, 'completed')

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader eyebrow="Tournament manager" title="Standings" />

      <Card>
        <CardHeader>
          <CardTitle>Tournament standings</CardTitle>
          <CardDescription>
            Track ranks, match points, and tiebreakers across rounds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {board === undefined ? (
            <TableLoadingSkeleton />
          ) : (
            <>
              {navigation.activePhase ? (
                <TournamentPhaseTabs
                  activePhaseId={navigation.activePhase.phase._id}
                  phases={navigation.phases}
                  onValueChange={navigation.selectPhase}
                />
              ) : null}

              {!navigation.selectedRound ? (
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
                  <TournamentRoundTabs
                    activeRoundNumber={navigation.selectedRound.roundNumber}
                    availableRoundNumbers={navigation.availableRounds.map(
                      (round) => round.roundNumber,
                    )}
                    onValueChange={navigation.selectRound}
                    roundCount={navigation.roundTabCount}
                  />
                  <StandingsTable roundId={navigation.selectedRound._id} />
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

function StandingsTable({ roundId }: { roundId: Id<'tournamentRounds'> }) {
  const standings = useQuery(api.tournaments.rounds.listRoundStandings, {
    roundId,
  })

  if (standings === undefined) {
    return <TableLoadingSkeleton />
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
        {formatRecord(
          standing.matchWins,
          standing.matchLosses,
          standing.matchDraws,
        )}
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
