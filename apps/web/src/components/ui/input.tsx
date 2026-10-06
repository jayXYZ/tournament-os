import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Radix Themes TextField, size 2, variant "surface": 32px tall, radius 2,
 * 14px text on a translucent surface with an inset gray-a7 hairline. Focus is
 * a 2px inset outline in the accent's step 8; disabled and read-only fields
 * wash the surface with gray-a2, soften the hairline to a6, and dim the text
 * to gray-a11 instead of fading the whole control.
 */
const inputClassName =
  'h-8 w-full min-w-0 rounded-(--radius-2) bg-surface px-2 text-sm text-foreground ring-1 ring-gray-a7 ring-inset transition-[box-shadow,background-color] duration-100 outline-none selection:bg-iris-a5 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-gray-a10 read-only:text-gray-a11 read-only:ring-gray-a6 read-only:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-gray-a11 disabled:ring-gray-a6 disabled:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputClassName, className)}
      {...props}
    />
  )
}

export { Input, inputClassName }
