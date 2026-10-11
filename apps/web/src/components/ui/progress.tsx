'use client'

import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * Radix Themes Progress, variant "surface": a gray-a3 track with a gray-a4
 * hairline and an accent indicator. `default` is Themes size 1 (4px), `lg`
 * size 2 (8px).
 */
function Progress({
  className,
  value,
  size = 'default',
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  size?: 'default' | 'lg'
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-size={size}
      className={cn(
        'relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-gray-a3 ring-1 ring-gray-a4 ring-inset data-[size=lg]:h-2',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 rounded-full bg-accent-brand transition-transform duration-[120ms]"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
