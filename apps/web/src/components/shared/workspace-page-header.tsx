import type { ReactNode } from 'react'

export function WorkspacePageHeader({
  actions,
  metadata,
  title,
}: {
  actions?: ReactNode
  metadata?: ReactNode
  title: ReactNode
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {metadata}
      </div>
      {actions}
    </div>
  )
}
