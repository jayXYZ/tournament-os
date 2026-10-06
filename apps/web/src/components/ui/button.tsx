import * as React from 'react'
import { cva } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Mirrors the Radix Themes Button spec (radix-ui.com/themes/docs/components/button)
 * on the shadcn API, so call sites keep `variant`/`size` while the look
 * follows Themes step for step:
 *
 *   default     → solid, high contrast (gray-12 on gray-1)
 *   brand       → solid, accent (iris-9, hover iris-10)
 *   outline     → surface, gray (translucent panel, inset a7 ring, hover a8)
 *   secondary   → soft, gray (a3 rest, a4 hover, a5 active)
 *   ghost       → ghost, gray (transparent, a3 hover, a4 active)
 *   destructive → soft, red (red-a3 on red-a11)
 *
 *   sm / default / lg → Themes sizes 1 / 2 / 3 (24 / 32 / 40px, radius 1 / 2 / 3)
 *   xs is one step below Themes for dense table and chip contexts.
 *
 * Disabled is Themes' own: gray-a8 text on gray-a3, never opacity. Focus is a
 * 2px outline in the accent's step 8, offset outward on solids and inset on
 * everything else.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center align-top font-medium whitespace-nowrap outline-none select-none transition-[background-color,box-shadow,color,filter] duration-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:pointer-events-none disabled:text-gray-a8 disabled:[filter:none] aria-invalid:ring-1 aria-invalid:ring-red-a8 aria-invalid:ring-inset [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:[filter:contrast(0.88)_saturate(1.1)_brightness(1.1)] focus-visible:outline-offset-2 active:[filter:contrast(0.82)_saturate(1.2)_brightness(1.16)] disabled:bg-gray-a3 aria-expanded:[filter:contrast(0.88)_saturate(1.1)_brightness(1.1)] dark:hover:[filter:contrast(0.88)_saturate(1.3)_brightness(1.18)] dark:active:[filter:brightness(0.95)_saturate(1.2)] dark:aria-expanded:[filter:contrast(0.88)_saturate(1.3)_brightness(1.18)] [&_svg]:opacity-90',
        brand:
          'bg-accent-brand text-accent-brand-foreground hover:bg-iris-10 focus-visible:outline-offset-2 active:bg-iris-10 active:[filter:brightness(0.92)_saturate(1.1)] disabled:bg-gray-a3 aria-expanded:bg-iris-10 dark:active:[filter:brightness(1.08)] [&_svg]:opacity-90',
        outline:
          'bg-gray-surface text-foreground ring-1 ring-gray-a7 ring-inset hover:ring-gray-a8 focus-visible:-outline-offset-1 active:bg-gray-a3 active:ring-gray-a8 disabled:bg-gray-a2 disabled:ring-gray-a6 aria-expanded:ring-gray-a8 [&_svg]:opacity-90',
        secondary:
          'bg-gray-a3 text-foreground hover:bg-gray-a4 focus-visible:-outline-offset-1 active:bg-gray-a5 disabled:bg-gray-a3 aria-expanded:bg-gray-a4 [&_svg]:opacity-90',
        ghost:
          'text-foreground hover:bg-gray-a3 focus-visible:-outline-offset-1 active:bg-gray-a4 disabled:bg-transparent aria-expanded:bg-gray-a3',
        destructive:
          'bg-red-a3 text-red-a11 hover:bg-red-a4 focus-visible:-outline-offset-1 focus-visible:outline-red-8 active:bg-red-a5 disabled:bg-gray-a3 aria-expanded:bg-red-a4 [&_svg]:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline focus-visible:-outline-offset-1',
      },
      size: {
        default:
          "h-8 gap-2 rounded-(--radius-2) px-3 text-sm/5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-5 gap-1 rounded-(--radius-1) px-1.5 text-[0.6875rem]/4 tracking-[0.0025em] has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-6 gap-1 rounded-(--radius-1) px-2 text-xs/4 tracking-[0.0025em] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-3 rounded-(--radius-3) px-4 text-base/6 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4.5",
        icon: "size-8 rounded-(--radius-2) [&_svg:not([class*='size-'])]:size-4",
        'icon-xs':
          "size-5 rounded-(--radius-1) [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          "size-6 rounded-(--radius-1) [&_svg:not([class*='size-'])]:size-3.5",
        'icon-lg':
          "size-10 rounded-(--radius-3) [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
