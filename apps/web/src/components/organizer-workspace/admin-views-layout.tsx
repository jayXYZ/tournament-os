import type { ReactNode } from 'react'

import { pageColumnClasses } from '@/components/shared/page-column'
import { cn } from '@/lib/utils'

export function AdminViewsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className={cn(pageColumnClasses, 'grid gap-6 py-4 sm:py-6 lg:py-8')}>
        {children}
      </div>
    </div>
  )
}
