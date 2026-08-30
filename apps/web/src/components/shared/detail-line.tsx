import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// One icon/label/value row for the public event pages' detail grids.
export function DetailLine({
  icon: Icon,
  label,
  value,
  capitalize = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-medium', capitalize && 'capitalize')}>
        {value}
      </span>
    </div>
  )
}
