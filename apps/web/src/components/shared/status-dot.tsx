import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatusTone =
  | 'live'
  | 'accent'
  | 'neutral'
  | 'muted'
  | 'warning'
  | 'danger'

// Exported so filter chips can draw the same dot beside a status option.
export const statusDotToneClassName: Record<StatusTone, string> = {
  live: 'bg-round-live',
  accent: 'bg-accent-brand',
  neutral: 'bg-foreground',
  muted: 'bg-muted-foreground',
  warning: 'bg-round-pairings',
  danger: 'bg-destructive',
}

// A state, not an action. Status is a dot and a word with no fill and no
// border, so it can never be mistaken for a button; semantic color lives on
// the dot alone. Counts and labels that need a pill keep using Badge.
export function StatusDot({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          statusDotToneClassName[tone],
        )}
      />
      {children}
    </span>
  )
}
