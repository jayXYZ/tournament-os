import type { ReactNode } from 'react'

export function AdminViewsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto grid max-w-6xl gap-6">{children}</div>
    </div>
  )
}
