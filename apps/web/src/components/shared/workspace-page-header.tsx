import type { ReactNode } from 'react'

export type WorkspacePageHeaderProps = {
  actions?: ReactNode
  eyebrow: ReactNode
  metadata?: ReactNode
  title: ReactNode
}

export function WorkspacePageHeader({
  actions,
  eyebrow,
  metadata,
  title,
}: WorkspacePageHeaderProps) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">{title}</h1>
          {metadata}
        </div>
      </div>
      {actions}
    </div>
  )
}
