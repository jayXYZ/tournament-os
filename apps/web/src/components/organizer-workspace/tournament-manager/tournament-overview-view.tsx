import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Settings } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { TournamentPublicPageContent } from '@/components/tournament-public-page'
import {
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
} from '@/components/tournaments'
import { Button } from '@/components/ui/button'

export function TournamentOverviewView({
  tournamentId,
  publicCode,
}: {
  tournamentId: string
  publicCode: string
}) {
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {setup ? (
          <div className="flex items-center gap-2">
            <TournamentLifecycleBadge lifecycle={setup.tournament.lifecycle} />
            <TournamentVisibilityBadge
              visibility={setup.tournament.visibility}
            />
          </div>
        ) : null}
        <Button asChild type="button" variant="outline" className="ml-auto">
          <Link
            to="/admin/tournaments/$tournamentId/settings"
            params={{ tournamentId: publicCode }}
          >
            <Settings data-icon="inline-start" />
            Settings
          </Link>
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Preview of the public event page as players see it.
        {setup?.tournament.lifecycle === 'setup'
          ? ' This event is still in setup, so only your team can see it.'
          : ''}
      </p>

      <div className="mx-auto grid w-full max-w-4xl gap-6">
        <TournamentPublicPageContent publicCode={publicCode} />
      </div>
    </section>
  )
}
