import { useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { CreateTournamentDialog } from './create-tournament-dialog'
import { useOrganization } from './organization-context'
import type { TournamentTableSearchParams } from '@/components/tournaments'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { TournamentTable } from '@/components/tournaments'

export function TournamentAdminView({
  search,
  onSearchChange,
}: {
  search: TournamentTableSearchParams
  onSearchChange: (next: TournamentTableSearchParams) => void
}) {
  const { selectedOrganizationId } = useOrganization()
  const tournaments = useQuery(
    api.tournaments.lifecycle.listForOrganization,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  const conventions = useQuery(
    api.conventions.lifecycle.listForOrganization,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  // Both lists feed one grouped table, so it stays in its loading state
  // until each has arrived rather than regrouping once conventions land.
  const loaded = tournaments !== undefined && conventions !== undefined
  const items = loaded
    ? tournaments.map((tournament) => ({
        key: tournament._id,
        registeredCount: tournament.registeredCount,
        tournament,
      }))
    : undefined
  const conventionItems = loaded
    ? conventions.map((convention) => ({
        key: convention._id,
        registeredCount: convention.registeredCount,
        convention,
      }))
    : undefined

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader
        title="Tournaments"
        actions={<CreateTournamentDialog />}
      />

      <TournamentTable
        variant="manage"
        items={items}
        conventions={conventionItems}
        search={search}
        onSearchChange={onSearchChange}
      />
    </section>
  )
}
