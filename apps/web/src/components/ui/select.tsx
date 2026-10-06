'use client'

import * as React from 'react'
import { cva } from 'class-variance-authority'
import { Select as SelectPrimitive } from 'radix-ui'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('scroll-my-2 p-2', className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/**
 * Radix Themes Select.Trigger, variant "surface": the Input's surface and
 * gray-a7 hairline, a8 on hover and while open, the inset accent focus
 * outline, and the gray-a2 wash when disabled. `default` is Themes size 2
 * (32px, 14px text), `sm` size 1 (24px, 12px text).
 */
const selectTriggerVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-between whitespace-nowrap text-foreground transition-[box-shadow,background-color] duration-100 outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-gray-a11 aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8 data-placeholder:text-gray-a10 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-surface ring-1 ring-gray-a7 ring-inset hover:ring-gray-a8 disabled:bg-gray-a2 disabled:ring-gray-a6 data-[state=open]:ring-gray-a8 [&_svg]:opacity-90',
        // Reads as plain text with a chevron until the pointer or keyboard
        // reaches it, then takes the ghost button's gray-a3 fill and keeps it
        // while the menu is open so the trigger doesn't vanish under it.
        ghost:
          'bg-transparent enabled:hover:bg-gray-a3 focus-visible:bg-gray-a3 disabled:bg-transparent data-[state=open]:bg-gray-a3 motion-reduce:transition-none',
      },
      size: {
        default:
          "h-8 gap-1.5 rounded-(--radius-2) px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-6 gap-1 rounded-(--radius-1) px-2 text-xs tracking-[0.0025em] [&_svg:not([class*='size-'])]:size-3",
      },
    },
    compoundVariants: [
      // Ghost lives inside running text, so it takes the surrounding font and
      // line-height instead of the control type scale and sits on the text
      // baseline. Negative margins cancel its padding so the hover box bleeds
      // around the words without moving them or changing the line height.
      {
        variant: 'ghost',
        class:
          "inline-flex h-auto gap-1 -mx-1 -my-0.5 px-1 py-0.5 align-baseline text-[length:inherit] leading-[inherit] [&_svg:not([class*='size-'])]:size-[1em]",
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function SelectTrigger({
  className,
  variant = 'default',
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-variant={variant}
      data-size={size}
      className={cn(selectTriggerVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-(--radius-4) bg-popover text-popover-foreground shadow-5 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            'data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)',
            position === 'popper' && '',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        'flex h-8 items-center px-6 text-sm text-gray-a10 select-none [[data-slot=select-item]+&]:mt-2',
        className,
      )}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex h-8 w-full cursor-default items-center gap-2 rounded-(--radius-2) px-6 text-sm outline-hidden select-none focus:bg-accent-brand focus:text-accent-brand-foreground not-data-[variant=destructive]:focus:**:text-accent-brand-foreground data-disabled:pointer-events-none data-disabled:text-gray-a8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-0 flex w-6 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none size-3" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        'pointer-events-none my-2 mr-3 ml-6 h-px bg-gray-a6',
        className,
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
}
