import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { CreateTournamentDialog } from './create-tournament-dialog'
import { useOrganization } from './organization-context'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { TournamentTable } from '@/components/tournaments'

export function TournamentAdminView() {
  const { selectedOrganizationId, selectedOrganization } = useOrganization()
  const tournaments = useQuery(
    api.tournaments.lifecycle.listUpcomingForOrganization,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  const items = tournaments?.map((tournament) => ({
    key: tournament._id,
    tournament,
  }))

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader
        eyebrow={selectedOrganization?.organization.name ?? 'Admin workspace'}
        title="Tournaments"
        actions={<CreateTournamentDialog />}
      />

      <TournamentTable variant="manage" items={items} />
    </section>
  )
}
