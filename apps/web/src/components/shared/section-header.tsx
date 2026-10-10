import type { ReactNode } from 'react'

// The block every page section opens with: a small title, a muted
// description, and optionally the section's actions on the right. Sections
// are unboxed, so this is the one place their heading level, spacing, and
// type live; a section passes only the parts it has.
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  const heading = (
    <div>
      {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
      {description ? (
        <p className="text-xs/relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
  if (!actions) {
    return heading
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {heading}
      {actions}
    </div>
  )
}
