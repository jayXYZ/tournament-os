import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Radix Themes TextArea, size 2, variant "surface": the Input's surface and
 * hairline on a 64px-minimum box with 6px/8px padding and 14/20 text.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full resize-none rounded-(--radius-2) bg-surface px-2 py-1.5 text-sm/5 text-foreground ring-1 ring-gray-a7 ring-inset transition-[box-shadow,background-color] duration-100 outline-none selection:bg-iris-a5 placeholder:text-gray-a10 read-only:text-gray-a11 read-only:ring-gray-a6 read-only:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-gray-a11 disabled:ring-gray-a6 disabled:bg-[image:linear-gradient(var(--gray-a2),var(--gray-a2))] aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
