import type { PaginationStatus } from 'convex/react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

// Footer for paginated lists: hidden until the first page arrives and once
// the history is exhausted, otherwise a centered button that disables (and
// swaps to loadingLabel, when given) while the next page loads.
export function LoadMoreButton({
  status,
  onLoadMore,
  label,
  loadingLabel,
  className,
}: {
  status: PaginationStatus
  onLoadMore: () => void
  label: string
  loadingLabel?: string
  className?: string
}) {
  if (status === 'LoadingFirstPage' || status === 'Exhausted') {
    return null
  }
  const loading = status === 'LoadingMore'
  return (
    <div className={cn('flex justify-center', className)}>
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={onLoadMore}
      >
        {loading && loadingLabel !== undefined ? (
          <>
            <Spinner />
            {loadingLabel}
          </>
        ) : (
          label
        )}
      </Button>
    </div>
  )
}
