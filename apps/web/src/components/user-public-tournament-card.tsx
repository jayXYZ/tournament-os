import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { ChevronDown, ChevronUp, Trophy } from 'lucide-react'
import { useState } from 'react'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import {
  displayPlayerName,
  formatGameScoreline,
  formatRecord,
} from '@paper-pairings/core'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

import { ResultBadge } from '@/components/shared/result-badge'
import { formatTournamentDateShort } from '@/components/tournaments'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type PlayerTournamentResult = FunctionReturnType<
  typeof api.users.getPublicPlayerResults
>['page'][number]

export function UserPublicTournamentCard({
  publicCode,
  result,
}: {
  publicCode: string
  result: PlayerTournamentResult
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/tournaments/$tournamentId"
              params={{ tournamentId: String(result.tournamentPublicCode) }}
              className="text-base font-semibold hover:underline"
            >
              {result.tournamentName}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatTournamentDateShort(result.startDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {result.format}
            </Badge>
            {result.registrationStatus === 'dropped' ? (
              <Badge variant="secondary">Dropped</Badge>
            ) : null}
            <Badge variant="secondary">
              <Trophy aria-hidden="true" />
              {result.finalRank !== null ? `#${result.finalRank}` : 'Unranked'}
            </Badge>
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatRecord(
                result.matchWins,
                result.matchLosses,
                result.matchDraws,
              )}
              {' · '}
              {result.matchPoints} pts
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={
                expanded ? 'Hide round results' : 'Show round results'
              }
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded ? (
        <CardContent className="grid gap-4">
          <Separator />
          <MatchLog
            publicCode={publicCode}
            tournamentId={result.tournamentId}
          />
        </CardContent>
      ) : null}
    </Card>
  )
}

function MatchLog({
  publicCode,
  tournamentId,
}: {
  publicCode: string
  tournamentId: Id<'tournaments'>
}) {
  const log = useQuery(api.users.getPublicPlayerTournamentLog, {
    publicCode,
    tournamentId,
  })

  if (log === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading round results…
      </div>
    )
  }
  if (log === null || log.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No round results are available for this tournament.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Round</TableHead>
          <TableHead>Opponent</TableHead>
          <TableHead>Games</TableHead>
          <TableHead className="text-right">Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {log.map((row) => (
          <TableRow key={row.roundNumber}>
            <TableCell className="text-muted-foreground">
              {row.roundName}
            </TableCell>
            <TableCell>
              {row.isBye ? 'Bye' : displayPlayerName(row.opponentName)}
            </TableCell>
            <TableCell className="tabular-nums">
              {row.myGameWins !== null && row.myGameLosses !== null
                ? formatGameScoreline(
                    row.myGameWins,
                    row.myGameLosses,
                    row.myGameDraws ?? 0,
                  )
                : '—'}
            </TableCell>
            <TableCell className="text-right">
              <ResultBadge result={row.result} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
