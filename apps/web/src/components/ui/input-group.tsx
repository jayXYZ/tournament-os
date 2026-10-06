'use client'

import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        // The group wears the Input's surface, hairline, focus outline, and
        // disabled wash; the control inside strips its own (InputGroupInput).
        'group/input-group relative flex h-8 w-full min-w-0 items-center rounded-(--radius-2) bg-surface ring-1 ring-gray-a7 ring-inset transition-[box-shadow,background-color] duration-100 outline-none has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-solid has-[[data-slot=input-group-control]:focus-visible]:-outline-offset-1 has-[[data-slot=input-group-control]:focus-visible]:outline-ring in-data-[slot=combobox-content]:has-[[data-slot=input-group-control]:focus-visible]:outline-0 has-[[data-slot][aria-invalid=true]]:ring-red-a8 has-[[data-slot][aria-invalid=true]]:outline-red-8 has-[[data-slot=input-group-control]:disabled]:ring-gray-a6 has-[[data-slot=input-group-control]:disabled]:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5',
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  // Radix TextField.Slot: gray-a11 content, 8px gutters, 16px icons.
  "flex h-auto cursor-text items-center justify-center gap-2 py-2 text-sm text-gray-a11 select-none group-has-[[data-slot=input-group-control]:disabled]/input-group:text-gray-a8 **:data-[slot=kbd]:rounded-(--radius-1) **:data-[slot=kbd]:bg-gray-a3 **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-xs [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        'inline-start':
          'order-first pl-2 has-[>button]:ml-[-0.275rem] has-[>kbd]:ml-[-0.275rem]',
        'inline-end':
          'order-last pr-2 has-[>button]:mr-[-0.275rem] has-[>kbd]:mr-[-0.275rem]',
        'block-start':
          'order-first w-full justify-start px-2 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2',
        'block-end':
          'order-last w-full justify-start px-2 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  // Slot buttons are Radix size 1 (24px) inside the size-2 field.
  'flex items-center gap-1 rounded-(--radius-1) text-xs shadow-none',
  {
    variants: {
      size: {
        xs: "h-6 px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: 'h-6 px-2',
        'icon-xs':
          "size-6 p-0 has-[>svg]:p-0 [&>svg:not([class*='size-'])]:size-3.5",
        'icon-sm':
          "size-7 p-0 has-[>svg]:p-0 [&>svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      size: 'xs',
    },
  },
)

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm text-gray-a11 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none bg-transparent ring-0 focus-visible:outline-0 read-only:bg-none disabled:bg-none disabled:ring-0 aria-invalid:ring-0',
        className,
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'flex-1 resize-none rounded-none bg-transparent py-2 ring-0 focus-visible:outline-0 read-only:bg-none disabled:bg-none disabled:ring-0 aria-invalid:ring-0',
        className,
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
