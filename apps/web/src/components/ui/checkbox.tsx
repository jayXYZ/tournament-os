'use client'

import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

import { CheckIcon, MinusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Radix Themes Checkbox, size 2, variant "surface": a 16px box at radius 1.
 * Unchecked it wears the Input's surface and gray-a7 hairline; checked it
 * fills with the accent and draws a white mark. Focus is the accent's step 8,
 * 2px outside the box. Disabled keeps the hairline at a6 over a gray-a3 fill
 * and dims the mark to gray-a8. The invisible `after` pad widens the hit
 * area to a comfortable target.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-(--radius-1) bg-surface ring-1 ring-gray-a7 ring-inset transition-[background-color,box-shadow] duration-100 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-gray-a3 disabled:text-gray-a8 disabled:ring-gray-a6 aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8 data-checked:bg-accent-brand data-checked:text-accent-brand-foreground data-checked:ring-0 data-checked:disabled:bg-gray-a3 data-checked:disabled:text-gray-a8 data-checked:disabled:ring-1 data-[state=indeterminate]:bg-accent-brand data-[state=indeterminate]:text-accent-brand-foreground data-[state=indeterminate]:ring-0',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3 [&>svg]:stroke-[3]"
      >
        {props.checked === 'indeterminate' ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
