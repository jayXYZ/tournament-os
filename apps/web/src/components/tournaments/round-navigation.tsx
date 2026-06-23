import { useState } from 'react'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type RoundNavigationMode = 'all' | 'completed'

export type TournamentRoundNavigationPhase = {
  phase: Pick<
    Doc<'tournamentPhases'>,
    '_id' | 'phaseName' | 'phaseOrder' | 'phaseStatus' | 'phaseTotalRounds'
  >
  rounds: Array<
    Pick<Doc<'tournamentRounds'>, '_id' | 'roundNumber' | 'roundStatus'>
  >
}

export function useTournamentRoundNavigation(
  phases: Array<TournamentRoundNavigationPhase>,
  mode: RoundNavigationMode,
) {
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(
    null,
  )

  const defaultPhase =
    phases.find(({ phase }) => phase.phaseStatus === 'in_progress') ??
    phases.at(0)
  const activePhase =
    phases.find(({ phase }) => phase._id === selectedPhaseId) ?? defaultPhase
  const allRounds = activePhase?.rounds ?? []
  const availableRounds =
    mode === 'completed'
      ? allRounds.filter((round) => round.roundStatus === 'completed')
      : allRounds
  const selectedRound =
    availableRounds.find(
      (round) => round.roundNumber === selectedRoundNumber,
    ) ?? availableRounds.at(-1)
  const roundTabCount = Math.max(
    activePhase?.phase.phaseTotalRounds ?? 0,
    allRounds.length,
  )

  return {
    activePhase,
    availableRounds,
    phases,
    roundTabCount,
    selectedRound,
    resetRoundSelection: () => setSelectedRoundNumber(null),
    selectPhase: (phaseId: string) => {
      setSelectedPhaseId(phaseId)
      setSelectedRoundNumber(null)
    },
    selectRound: setSelectedRoundNumber,
  }
}

export function TournamentPhaseTabs({
  activePhaseId,
  onValueChange,
  phases,
}: {
  activePhaseId: string
  onValueChange: (phaseId: string) => void
  phases: Array<TournamentRoundNavigationPhase>
}) {
  if (phases.length <= 1) {
    return null
  }

  return (
    <Tabs value={activePhaseId} onValueChange={onValueChange}>
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {phases.map(({ phase }) => (
          <TabsTrigger
            key={phase._id}
            value={phase._id}
            disabled={phase.phaseStatus === 'upcoming'}
          >
            {phase.phaseName ?? `Phase ${phase.phaseOrder}`}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function TournamentRoundTabs({
  activeRoundNumber,
  availableRoundNumbers,
  onValueChange,
  roundCount,
}: {
  activeRoundNumber: number
  availableRoundNumbers: Array<number>
  onValueChange: (roundNumber: number) => void
  roundCount: number
}) {
  const availableRounds = new Set(availableRoundNumbers)

  return (
    <Tabs
      value={String(activeRoundNumber)}
      onValueChange={(value) => onValueChange(Number(value))}
    >
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {Array.from({ length: roundCount }, (_, index) => {
          const roundNumber = index + 1
          return (
            <TabsTrigger
              key={roundNumber}
              value={String(roundNumber)}
              disabled={!availableRounds.has(roundNumber)}
            >
              Round {roundNumber}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
