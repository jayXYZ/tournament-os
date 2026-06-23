import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function TableLoadingSkeleton({
  className,
  rows = 3,
}: {
  className?: string
  rows?: number
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12" />
      ))}
    </div>
  )
}
