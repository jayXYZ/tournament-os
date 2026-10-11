import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Radix Themes TextField, variant "surface", minus the size: 14px text on a
 * translucent surface with an inset gray-a7 hairline at radius 2. Focus is a
 * 2px inset outline in the accent's step 8; disabled and read-only fields
 * wash the surface with gray-a2, soften the hairline to a6, and dim the text
 * to gray-a11 instead of fading the whole control. Read-only keys off the
 * `readonly` attribute rather than `:read-only`, because file, range, color
 * and checkbox inputs always match `:read-only` and would otherwise wear the
 * dimmed wash while enabled. Input and Textarea share this and add their own
 * box; composite fields (InputGroup, ComboboxChips, MarkdownEditor) restate
 * it with `has-*` / `focus-within` variants because the control that takes
 * focus is a descendant.
 */
const fieldClassName =
  'rounded-(--radius-2) bg-surface text-sm text-foreground ring-1 ring-gray-a7 ring-inset transition-[box-shadow,background-color] duration-100 outline-none selection:bg-iris-a5 placeholder:text-gray-a10 [&[readonly]]:text-gray-a11 [&[readonly]]:ring-gray-a6 [&[readonly]]:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-gray-a11 disabled:ring-gray-a6 disabled:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8'

// Size 2: 32px tall with 8px gutters.
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClassName,
        'h-8 w-full min-w-0 px-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Input, fieldClassName }
