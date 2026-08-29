import { createFileRoute } from '@tanstack/react-router'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { ConventionAdminView } from '@/components/organizer-workspace/convention-admin-view'

export const Route = createFileRoute('/admin/conventions/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AdminViewsLayout>
      <ConventionAdminView />
    </AdminViewsLayout>
  )
}
