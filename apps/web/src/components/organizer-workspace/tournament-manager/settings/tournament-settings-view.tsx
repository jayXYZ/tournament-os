import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { DangerZoneCard } from './danger-zone-card'
import { EventDetailsCard } from './event-details-card'
import { isPreStartLocked } from './is-pre-start-locked'
import { PairingsPublicationCard } from './pairings-publication-card'
import { PhaseSettingsCard } from './phase-settings-card'
import { SettingsSkeleton } from './settings-skeleton'
import { TournamentSettingsCard } from './tournament-settings-card'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
} from '@/components/tournaments'

export function TournamentSettingsView({
  tournamentId,
}: {
  tournamentId: string
}) {
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  return (
    <section className="flex flex-col gap-4">
      {setup ? (
        <div className="flex items-center gap-2">
          <TournamentLifecycleBadge lifecycle={setup.tournament.lifecycle} />
          <TournamentVisibilityBadge visibility={setup.tournament.visibility} />
        </div>
      ) : null}

      {setup === undefined ? (
        <SettingsSkeleton />
      ) : (
        <>
          {isPreStartLocked(setup.tournament) ? (
            <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              {setup.tournament.lifecycle === 'cancelled'
                ? 'This tournament has been cancelled. Its settings can no longer be changed.'
                : 'Core and phase settings are locked after tournament play begins. Visibility, event details, and pairing publication preferences can still be changed.'}
            </p>
          ) : null}
          <TournamentSettingsCard
            key={setup.tournament._id}
            tournament={setup.tournament}
          />
          <PairingsPublicationCard tournament={setup.tournament} />
          <EventDetailsCard
            key={`${setup.tournament._id}-details`}
            tournament={setup.tournament}
          />
          <PhaseSettingsCard
            key={setup.phases
              .map((phase) => `${phase._id}:${phase.updatedAt}`)
              .join('|')}
            tournament={setup.tournament}
            phases={setup.phases}
          />
          <DangerZoneCard tournament={setup.tournament} />
        </>
      )}
    </section>
  )
}
