import { useLatestStandings } from '@paper-pairings/core'
import { ListOrdered } from 'lucide-react'

import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import { SectionHeader } from '@/components/shared/section-header'
import { StandingsRows } from '@/components/shared/standings-rows'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

export function StandingsList({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const standings = useLatestStandings(tournamentId)

  if (standings === undefined) {
    return <Skeleton className="h-56" />
  }

  if (standings === null) {
    return (
      <Empty className="min-h-60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListOrdered aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No standings yet</EmptyTitle>
          <EmptyDescription>
            Standings appear after the first round is completed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const myRow = standings.rows.find((row) => row.isMe)

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Standings"
        description={
          <>
            After round {standings.roundNumber}
            {myRow
              ? ` · You're ${ordinal(myRow.rank)} with ${myRow.matchPoints} ${
                  myRow.matchPoints === 1 ? 'point' : 'points'
                }`
              : ''}
          </>
        }
      />
      <StandingsRows rows={standings.rows} />
    </section>
  )
}

function ordinal(value: number) {
  const remainderTen = value % 10
  const remainderHundred = value % 100
  if (remainderTen === 1 && remainderHundred !== 11) {
    return `${value}st`
  }
  if (remainderTen === 2 && remainderHundred !== 12) {
    return `${value}nd`
  }
  if (remainderTen === 3 && remainderHundred !== 13) {
    return `${value}rd`
  }
  return `${value}th`
}
