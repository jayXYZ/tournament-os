import * as React from 'react'

import { cn } from '@/lib/utils'
import { fieldClassName } from '@/components/ui/input'

/**
 * Radix Themes TextArea, size 2, variant "surface": the Input's surface and
 * hairline on a 64px-minimum box with 6px/8px padding and 14/20 text.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldClassName,
        'flex field-sizing-content min-h-16 w-full resize-none px-2 py-1.5',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
