'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

// Radix Themes Table, variant "surface": a panel-colored frame with the
// blended gray-a5 border, a gray-a2 header band, 14px text, and gray-a5 rules
// between rows. `default` is Themes size 1 (36px rows, 8px cell padding,
// radius 3); `lg` is size 2 (44px rows, 12px padding, radius 4). The size
// lives in two variables on the container so every cell reads it. A table is
// its own bordered container, so it never needs a card around it. `bare`
// drops the frame for tables that sit inside another framed surface.
function Table({
  className,
  bare = false,
  size = 'default',
  ...props
}: React.ComponentProps<'table'> & {
  bare?: boolean
  size?: 'default' | 'lg'
}) {
  return (
    <div
      data-slot="table-container"
      data-size={size}
      className={cn(
        'relative w-full overflow-x-auto [--table-cell-padding:--spacing(2)] [--table-row-height:36px] data-[size=lg]:[--table-cell-padding:--spacing(3)] data-[size=lg]:[--table-row-height:44px]',
        !bare &&
          'rounded-(--radius-3) border border-table-border bg-card data-[size=lg]:rounded-(--radius-4)',
      )}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-gray-a2 [&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t border-gray-a5 bg-gray-a2 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-gray-a5 transition-colors duration-100 hover:bg-gray-a2 has-aria-expanded:bg-gray-a2 data-[state=selected]:bg-gray-a3',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-(--table-row-height) px-(--table-cell-padding) text-left align-middle font-bold whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'h-(--table-row-height) px-(--table-cell-padding) py-1 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-gray-a11', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
