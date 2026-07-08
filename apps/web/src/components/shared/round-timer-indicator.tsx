import { Timer } from 'lucide-react'
import { useRoundTimer } from '@tournament-os/core'

import type { RoundTimer } from '@tournament-os/core'
import { cn } from '@/lib/utils'

// Compact read-only live countdown for the tournament's round timer, shared by
// the public event page, player controller, and admin chrome. Renders nothing
// when no timer is set; overtime (and a timer paused in overtime) goes
// destructive with a "+m:ss" count-up.
export function RoundTimerIndicator({
  timer,
  className,
}: {
  timer: RoundTimer | null | undefined
  className?: string
}) {
  const { phase, remainingMs, formatted } = useRoundTimer(timer)
  if (phase === 'idle') {
    return null
  }

  const overtime = remainingMs < 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium tabular-nums',
        overtime
          ? 'border-destructive/40 text-destructive'
          : 'border-border text-foreground',
        className,
      )}
    >
      <Timer className="size-3.5 shrink-0" aria-hidden="true" />
      {phase === 'paused' ? (
        <span className="font-normal text-muted-foreground">Paused</span>
      ) : null}
      {formatted}
    </span>
  )
}
