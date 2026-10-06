'use client'

import * as React from 'react'
import { Separator as SeparatorPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        // Radix Themes Separator, size 4 (full length): a 1px gray-a6 rule.
        'shrink-0 bg-gray-a6 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
