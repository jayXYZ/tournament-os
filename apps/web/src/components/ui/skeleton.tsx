import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={
        // Radix Themes Skeleton: a gray-a3 block at radius 1 that pulses.
        cn('animate-pulse rounded-(--radius-1) bg-gray-a3', className)
      }
      {...props}
    />
  )
}

export { Skeleton }
