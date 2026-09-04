import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { ManagedConventionProvider } from '@/components/organizer-workspace/convention-manager/convention-manager-context'
import { ConventionManagerSubnav } from '@/components/organizer-workspace/convention-manager/convention-manager-subnav'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/admin/conventions/$conventionId')({
  component: ConventionManagerLayout,
})

function ConventionManagerLayout() {
  // The URL param is the public convention code, not the Convex id.
  const { conventionId: publicCode } = Route.useParams()
  const managed = useQuery(api.conventions.lifecycle.getManagedConvention, {
    publicCode,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConventionManagerSubnav publicCode={publicCode} />

      <AdminViewsLayout>
        {managed === undefined ? (
          <Skeleton className="h-72" />
        ) : managed === null ? (
          <p className="text-sm text-muted-foreground">Convention not found.</p>
        ) : (
          <ManagedConventionProvider
            value={{ publicCode, conventionId: managed.convention._id }}
          >
            <Outlet />
          </ManagedConventionProvider>
        )}
      </AdminViewsLayout>
    </div>
  )
}
