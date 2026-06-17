import { createFileRoute } from '@tanstack/react-router'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { StaffView } from '@/components/organizer-workspace/staff-view'

export const Route = createFileRoute('/admin/staff')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AdminViewsLayout>
      <StaffView />
    </AdminViewsLayout>
  )
}
