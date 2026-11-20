import { useState } from 'react'
import {
  displayPlayerName,
  formatPercent,
  formatRecord,
  standingStatusLabel,
} from '@paper-pairings/core'
import type { StandingRow } from '@paper-pairings/core'
import { cn } from '@/lib/utils'

// One standings row as the player and public standings render it: the
// public projection (model/publicResults.ts standingRowProjection), plus the
// player view's own "is this me" marker where there is one.
export type StandingsRowData = Omit<StandingRow, 'isMe'> & { isMe?: boolean }

// The rank-ordered standings list shared by the player view and the public
// event page. Ranks are unique within a round, so they key the rows. Each row
// expands to its tiebreakers.
export function StandingsRows({ rows }: { rows: Array<StandingsRowData> }) {
  return (
    <div className="grid gap-1.5">
      {rows.map((row) => (
        <StandingsRow key={row.rank} row={row} />
      ))}
    </div>
  )
}

function StandingsRow({ row }: { row: StandingsRowData }) {
  const [expanded, setExpanded] = useState(false)
  const statusLabel = standingStatusLabel(row)

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      className={cn(
        'rounded-md border px-3 py-2 text-left',
        row.isMe ? 'border-primary bg-primary/5' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="w-7 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
          {row.rank}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {displayPlayerName(row.name)}
          {row.isMe ? (
            <span className="text-muted-foreground"> (you)</span>
          ) : null}
        </span>
        {statusLabel ? (
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        ) : null}
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatRecord(row.matchWins, row.matchLosses, row.matchDraws)}
        </span>
        <span className="w-10 text-right text-sm font-semibold tabular-nums">
          {row.matchPoints}
        </span>
      </div>
      {expanded ? (
        <p className="mt-1.5 pl-10 text-xs text-muted-foreground">
          OMW {formatPercent(row.opponentMatchWinPct)} · GW{' '}
          {formatPercent(row.gameWinPct)} · OGW{' '}
          {formatPercent(row.opponentGameWinPct)}
        </p>
      ) : null}
    </button>
  )
}
