'use client'

import * as React from 'react'
import { cva } from 'class-variance-authority'
import { Tabs as TabsPrimitive } from 'radix-ui'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        'group/tabs flex gap-4 data-horizontal:flex-col',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Two Radix Themes controls behind one API. `default` is the Themes
 * SegmentedControl, size 2: a 32px gray-a3 well at radius 2 whose active
 * segment lifts out as a white (dark: gray-a3) pill under elevation 2.
 * `line` is Themes Tabs, size 2: 40px triggers on a gray-a5 baseline, gray-a11
 * text that turns gray-12 with an inner gray-a3 pill on hover, and a 2px
 * accent indicator under the active one.
 */
const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default:
          'isolate justify-center rounded-(--radius-2) bg-surface bg-[image:linear-gradient(var(--gray-a3),var(--gray-a3))] text-foreground group-data-horizontal/tabs:h-8',
        line: 'justify-start text-gray-a11 group-data-horizontal/tabs:h-10 group-data-horizontal/tabs:shadow-[inset_0_-1px_0_0_var(--gray-a5)] group-data-vertical/tabs:shadow-[inset_-1px_0_0_0_var(--gray-a5)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap transition-[color,background-color] duration-100 outline-none select-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start disabled:pointer-events-none disabled:text-gray-a8 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 data-active:font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Segmented: 1px inset pill on the active segment, gray-a2 on hover.
        'group-data-[variant=default]/tabs-list:h-full group-data-[variant=default]/tabs-list:rounded-(--radius-2) group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:text-sm group-data-[variant=default]/tabs-list:before:absolute group-data-[variant=default]/tabs-list:before:inset-px group-data-[variant=default]/tabs-list:before:-z-10 group-data-[variant=default]/tabs-list:before:rounded-[max(0.5px,calc(var(--radius-2)-1px))] group-data-[variant=default]/tabs-list:hover:bg-gray-a2 group-data-[variant=default]/tabs-list:focus-visible:outline-2 group-data-[variant=default]/tabs-list:focus-visible:outline-solid group-data-[variant=default]/tabs-list:focus-visible:-outline-offset-1 group-data-[variant=default]/tabs-list:focus-visible:outline-ring group-data-[variant=default]/tabs-list:data-active:hover:bg-transparent group-data-[variant=default]/tabs-list:data-active:before:bg-background group-data-[variant=default]/tabs-list:data-active:before:shadow-2 dark:group-data-[variant=default]/tabs-list:data-active:before:bg-gray-a3',
        // Line: inner hover pill (`before`), accent indicator (`after`).
        'group-data-[variant=line]/tabs-list:h-full group-data-[variant=line]/tabs-list:px-2 group-data-[variant=line]/tabs-list:text-sm group-data-[variant=line]/tabs-list:hover:text-foreground group-data-[variant=line]/tabs-list:data-active:text-foreground group-data-[variant=line]/tabs-list:before:absolute group-data-[variant=line]/tabs-list:before:inset-x-0 group-data-[variant=line]/tabs-list:before:inset-y-2 group-data-[variant=line]/tabs-list:before:-z-10 group-data-[variant=line]/tabs-list:before:rounded-(--radius-2) group-data-[variant=line]/tabs-list:hover:before:bg-gray-a3 group-data-[variant=line]/tabs-list:focus-visible:before:outline-2 group-data-[variant=line]/tabs-list:focus-visible:before:outline-solid group-data-[variant=line]/tabs-list:focus-visible:before:-outline-offset-2 group-data-[variant=line]/tabs-list:focus-visible:before:outline-ring group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:bg-accent-brand group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:data-active:after:opacity-100 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:after:bottom-0 group-data-horizontal/tabs:group-data-[variant=line]/tabs-list:after:h-0.5 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:after:inset-y-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:after:right-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:after:w-0.5',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
