'use client'

import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid w-full gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        // Radix Themes Radio, size 2, variant "surface": the Checkbox's surface
        // and hairline in a 16px circle, filling with the accent behind a white
        // dot at 40% of its size when checked.
        'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full bg-surface ring-1 ring-gray-a7 ring-inset transition-[background-color,box-shadow] duration-100 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-gray-a3 disabled:ring-gray-a6 aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8 data-checked:bg-accent-brand data-checked:ring-0 data-checked:disabled:bg-gray-a3 data-checked:disabled:ring-1',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white group-disabled/radio-group-item:bg-gray-a8" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
