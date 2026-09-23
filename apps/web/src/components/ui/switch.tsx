'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * Radix Themes Switch, variant "surface". `default` is Themes size 2: a
 * 20×35 pill whose track rests on gray-a3 with a gray-a5 hairline and fills
 * with the accent when checked. `sm` is size 1 at 16×28. The thumb is always
 * white, inset 1px, and carries Themes' own drop shadow, which picks up an
 * accent-a4 ring once checked. Focus is the accent's step 8, 2px outside the
 * track. Disabled flattens the track to gray-a3 and the thumb to gray-2.
 */
function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full ring-1 ring-gray-a5 ring-inset transition-[background-color,box-shadow,filter] duration-150 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:ring-red-a8 aria-invalid:focus-visible:outline-red-8 data-[size=default]:h-5 data-[size=default]:w-[35px] data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:bg-accent-brand data-checked:active:[filter:brightness(0.92)_saturate(1.1)] data-unchecked:bg-gray-a3 data-unchecked:active:bg-gray-a4 data-disabled:cursor-not-allowed data-disabled:bg-gray-a3 data-disabled:ring-gray-a3 data-disabled:[filter:none] dark:data-checked:active:[filter:brightness(1.08)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute left-px block rounded-full bg-white shadow-[0_0_1px_1px_var(--black-a2),0_1px_1px_var(--black-a1),0_2px_4px_-1px_var(--black-a1)] transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.45,0.05,0.55,0.95)] group-data-[size=default]/switch:size-[18px] group-data-[size=sm]/switch:size-3.5 data-checked:shadow-[0_1px_3px_var(--black-a2),0_2px_4px_-1px_var(--black-a1),0_0_0_1px_var(--black-a1),0_0_0_1px_var(--iris-a4),-1px_0_1px_var(--black-a2)] group-data-[size=default]/switch:data-checked:translate-x-[15px] group-data-[size=sm]/switch:data-checked:translate-x-3 data-disabled:bg-gray-2 data-disabled:shadow-[0_0_0_1px_var(--gray-a2),0_1px_3px_var(--black-a1)] data-disabled:transition-none"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
