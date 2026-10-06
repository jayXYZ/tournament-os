import * as React from 'react'

import { cn } from '@/lib/utils'

function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        // Radix Themes Card, variant "surface": the panel color at radius 4
        // with a blended gray hairline that firms up on hover and active when
        // the card is, or sits directly inside, a link or button. `default` is Themes size 2
        // (16px padding), `sm` size 1 (12px).
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-(--radius-4) bg-card py-(--card-spacing) text-sm text-card-foreground shadow-[0_0_0_1px_var(--card-border)] transition-shadow duration-100 outline-none [--card-spacing:--spacing(4)] has-[>img:first-child]:pt-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring data-[size=sm]:[--card-spacing:--spacing(3)] [&:is(a,button,label)]:hover:shadow-[0_0_0_1px_var(--card-border-hover)] [:is(a,button,label)>&]:hover:shadow-[0_0_0_1px_var(--card-border-hover)] [&:is(a,button,label)]:active:shadow-[0_0_0_1px_var(--card-border-active)] [:is(a,button,label)>&]:active:shadow-[0_0_0_1px_var(--card-border-active)] *:[img:first-child]:rounded-t-(--radius-4) *:[img:last-child]:rounded-b-(--radius-4)',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-(--radius-4) px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('font-heading text-sm font-bold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-gray-a11', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-(--card-spacing)', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b-(--radius-4) px-(--card-spacing) [.border-t]:pt-(--card-spacing)',
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
