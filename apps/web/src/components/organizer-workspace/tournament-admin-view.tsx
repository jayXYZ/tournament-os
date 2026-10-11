import { useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { CreateTournamentDialog } from './create-tournament-dialog'
import { useOrganization } from './organization-context'
import type { TournamentTableSearchParams } from '@/components/tournaments'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import {
  TournamentTable,
  activeTournamentLifecycles,
  endedTournamentLifecycles,
  searchAdmitsEndedEvents,
} from '@/components/tournaments'

export function TournamentAdminView({
  search,
  onSearchChange,
}: {
  search: TournamentTableSearchParams
  onSearchChange: (next: TournamentTableSearchParams) => void
}) {
  const { selectedOrganizationId } = useOrganization()
  // The list is read per lifecycle group. The events still in play are
  // always subscribed; completed and cancelled history only while the
  // Status chip reaches it, so widening the chip adds rows without
  // reloading the live ones and the default subscription stays small for
  // an organization with a long history.
  const active = useQuery(
    api.tournaments.lifecycle.listForOrganization,
    selectedOrganizationId
      ? {
          organizationId: selectedOrganizationId,
          lifecycles: activeTournamentLifecycles,
        }
      : 'skip',
  )
  const ended = useQuery(
    api.tournaments.lifecycle.listForOrganization,
    selectedOrganizationId && searchAdmitsEndedEvents(search)
      ? {
          organizationId: selectedOrganizationId,
          lifecycles: endedTournamentLifecycles,
        }
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
  // Ended events are not waited for: they join the table when they arrive.
  const loaded = active !== undefined && conventions !== undefined
  const items = loaded
    ? [...active.tournaments, ...(ended?.tournaments ?? [])].map(
        (tournament) => ({
          key: tournament._id,
          registeredCount: tournament.registeredCount,
          tournament,
        }),
      )
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
        // Until the ended list is in, the active read says whether the
        // Status chip is hiding history the organizer can widen it to.
        hasItemsBeyondStatusFilter={
          loaded && ended === undefined && active.hasEventsInOtherLifecycles
        }
      />
    </section>
  )
}
