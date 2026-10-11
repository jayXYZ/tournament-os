import { useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { CreateConventionDialog } from './create-convention-dialog'
import { useOrganization } from './organization-context'
import { ConventionTable } from '@/components/conventions/convention-table'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'

export function ConventionAdminView() {
  const { selectedOrganizationId } = useOrganization()
  const conventions = useQuery(
    api.conventions.lifecycle.listForOrganization,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  const items = conventions?.map((convention) => ({
    key: convention._id,
    registeredCount: convention.registeredCount,
    convention,
  }))

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader
        title="Conventions"
        actions={<CreateConventionDialog />}
      />

      <ConventionTable variant="manage" items={items} />
    </section>
  )
}
