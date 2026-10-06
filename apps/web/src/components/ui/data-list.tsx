import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// A description list after Radix Themes' DataList: a `<dl>` of label/value
// pairs. `horizontal` lays labels and values in two aligned columns,
// `vertical` stacks each pair, and `inline` flows the pairs like tokens with
// the label sitting beside its value.
const dataListVariants = cva('text-left', {
  variants: {
    orientation: {
      horizontal:
        'grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 *:data-[slot=data-list-item]:contents',
      vertical: 'flex flex-col gap-3',
      inline: 'flex flex-wrap gap-x-6 gap-y-1',
    },
    size: {
      sm: 'text-xs',
      default: 'text-sm',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
    size: 'default',
  },
})

function DataList({
  className,
  orientation,
  size,
  ...props
}: React.ComponentProps<'dl'> & VariantProps<typeof dataListVariants>) {
  return (
    <dl
      data-slot="data-list"
      data-orientation={orientation ?? 'horizontal'}
      className={cn(dataListVariants({ orientation, size }), className)}
      {...props}
    />
  )
}

function DataListItem({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="data-list-item"
      className={cn(
        'flex flex-col gap-0.5 in-data-[orientation=inline]:flex-row in-data-[orientation=inline]:items-baseline in-data-[orientation=inline]:gap-1.5',
        className,
      )}
      {...props}
    />
  )
}

function DataListLabel({ className, ...props }: React.ComponentProps<'dt'>) {
  return (
    <dt
      data-slot="data-list-label"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

function DataListValue({ className, ...props }: React.ComponentProps<'dd'>) {
  return (
    <dd
      data-slot="data-list-value"
      className={cn('font-medium text-foreground', className)}
      {...props}
    />
  )
}

export { DataList, DataListItem, DataListLabel, DataListValue }
