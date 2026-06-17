import { createFileRoute } from '@tanstack/react-router'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { OrganizationProfileView } from '@/components/organizer-workspace/organization-profile-view'

export const Route = createFileRoute('/admin/organization')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AdminViewsLayout>
      <OrganizationProfileView />
    </AdminViewsLayout>
  )
}
