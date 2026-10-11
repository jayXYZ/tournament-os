import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// The column an unboxed page stacks its sections in: a hairline between
// neighbours with the same breathing room on either side of it, and no rule
// or padding at the top or bottom. Sections render straight into it as
// children, so nothing sits between them and the first/last-child rules.
// `as` keeps a sidebar an <aside> or a labelled <section>.
export function SectionStack({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'aside' }) {
  return (
    <Tag
      className={cn(
        'flex flex-col divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0',
        className,
      )}
      {...props}
    />
  )
}
