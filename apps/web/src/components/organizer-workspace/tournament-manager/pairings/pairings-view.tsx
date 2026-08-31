import { useQuery } from 'convex/react'
import { Swords } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { DEFAULT_BEST_OF } from '@tournament-os/shared/match-structure'
import { PlayerMeetingCard } from '../player-meeting-card'
import { PairingsSettingsMenu } from './pairings-settings-menu'
import { PairingsTable } from './pairings-table'
import { UnpairedPlayersPanel } from './unpaired-players-panel'
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
  const navigation = useTournamentRoundNavigation(phases, 'all', roundSelection)

  const activePhase = navigation.activePhase?.phase
  const selectedRound = navigation.selectedRound

  // Manual pairing edits (break / re-pair / bye) exist only while the
  // selected round's pairings are organizer-only, and never in a bracket —
  // the same gate the backend enforces (model/manualPairing.ts).
  const canEditPairings =
    selectedRound?.roundStatus === 'in_progress' &&
    selectedRound.pairingsPublishedAt === undefined &&
    activePhase?.phaseType === 'swiss'

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
            ) : navigation.availableRounds.length === 0 || !selectedRound ? (
              <TableEmptyState
                icon={Swords}
                title="No pairings yet"
                description="Generate pairings to create the first round and assign players to tables."
              />
            ) : (
              <>
                {canEditPairings ? (
                  <UnpairedPlayersPanel roundId={selectedRound._id} />
                ) : null}
                <PairingsTable
                  roundId={selectedRound._id}
                  bestOf={activePhase?.bestOf ?? DEFAULT_BEST_OF}
                  canEditPairings={canEditPairings}
                />
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
