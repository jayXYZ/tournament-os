import { useQuery } from 'convex/react'
import { Swords } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { PlayerMeetingCard } from '../player-meeting-card'
import { PairingsSettingsMenu } from './pairings-settings-menu'
import { PairingsTable } from './pairings-table'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { RoundSelection } from '@/components/tournaments'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { useTournamentRoundNavigation } from '@/components/tournaments'
import { Card, CardContent } from '@/components/ui/card'

export function PairingsView({
  tournamentId,
  roundSelection,
  onRoundSelectionChange,
}: {
  tournamentId: Id<'tournaments'>
  roundSelection: RoundSelection
  onRoundSelectionChange: (selection: RoundSelection) => void
}) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  })

  const phases = board?.phases ?? []
  const navigation = useTournamentRoundNavigation(
    phases,
    'all',
    roundSelection,
    onRoundSelectionChange,
  )

  const activePhase = navigation.activePhase?.phase

  return (
    <section className="flex flex-col gap-4">
      {navigation.isPlayerMeetingSelected &&
      activePhase?.playerMeetingStatus !== undefined ? (
        <PlayerMeetingCard
          phaseId={activePhase._id}
          meetingStatus={activePhase.playerMeetingStatus}
        />
      ) : null}

      {!navigation.isPlayerMeetingSelected ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex justify-end">
              <PairingsSettingsMenu
                board={board}
                roundId={navigation.selectedRound?._id ?? null}
                onRewound={() => onRoundSelectionChange({})}
              />
            </div>
            {board === undefined ? (
              <TableLoadingSkeleton />
            ) : navigation.availableRounds.length === 0 ||
              !navigation.selectedRound ? (
              <TableEmptyState
                icon={Swords}
                title="No pairings yet"
                description="Generate pairings to create the first round and assign players to tables."
              />
            ) : (
              <PairingsTable roundId={navigation.selectedRound._id} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
