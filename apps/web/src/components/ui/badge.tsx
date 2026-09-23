import * as React from 'react'
import { cva } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Radix Themes Badge, size 1: 12px medium text on a 2px/6px pad at radius 1,
 * so it sits 20px tall beside size-1 controls. Variants map onto Themes':
 *
 *   default     → solid, high contrast (gray-12 on gray-1)
 *   brand       → soft, accent (iris-a3 on iris-a11)
 *   secondary   → soft, gray (gray-a3 on gray-a11)
 *   outline     → surface, gray (translucent panel, gray-a6 hairline)
 *   destructive → soft, red (red-a3 on red-a11)
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-(--radius-1) px-1.5 text-xs/4 font-medium tracking-[0.0025em] whitespace-nowrap transition-[background-color,box-shadow,color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-gray-a11',
        brand: 'bg-iris-a3 text-iris-a11 [a]:hover:bg-iris-a4',
        secondary: 'bg-gray-a3 text-gray-a11 [a]:hover:bg-gray-a4',
        outline:
          'bg-gray-surface text-gray-a11 ring-1 ring-gray-a6 ring-inset [a]:hover:ring-gray-a7',
        destructive: 'bg-red-a3 text-red-a11 [a]:hover:bg-red-a4',
        ghost: 'text-gray-a11 hover:bg-gray-a3 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
