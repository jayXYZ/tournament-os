import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { toTournamentCreationPhasePayload } from '@tournament-os/shared/tournament-creation-utils'
import { isPreStartLocked } from './is-pre-start-locked'
import type { FormEvent } from 'react'
import type { TournamentCreationPhaseForm } from '@tournament-os/shared/tournament-creation-utils'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import { TournamentPhaseEditor } from '@/components/tournaments/tournament-phase-editor'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function PhaseSettingsCard({
  tournament,
  phases,
}: {
  tournament: Doc<'tournaments'>
  phases: Array<Doc<'tournamentPhases'>>
}) {
  const updateTournamentPhases = useMutation(
    api.tournaments.lifecycle.updateTournamentPhases,
  )
  const [phaseForms, setPhaseForms] = useState<
    Array<TournamentCreationPhaseForm>
  >(() =>
    phases.map((phase) => ({
      id: phase._id,
      phaseType: phase.phaseType,
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds:
        phase.phaseTotalRounds === null
          ? '3'
          : String(phase.phaseTotalRounds),
      playerMeeting: phase.playerMeeting ?? false,
    })),
  )
  const { busy, run } = useBusyAction()
  const locked = isPreStartLocked(tournament)
  const existingPhaseIds = new Set(phases.map((phase) => phase._id))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const phasePayloads = toTournamentCreationPhasePayload(phaseForms)
      await updateTournamentPhases({
        tournamentId: tournament._id,
        phases: phasePayloads.map((phase, index) => ({
          ...phase,
          ...(existingPhaseIds.has(
            phaseForms[index].id as Id<'tournamentPhases'>,
          )
            ? {
                phaseId: phaseForms[index].id as Id<'tournamentPhases'>,
              }
            : {}),
        })),
      })
      toast.success('Tournament phases saved.')
    }, 'Could not save tournament phases.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phase settings</CardTitle>
        <CardDescription>
          {locked
            ? 'Phase structure is locked after tournament play begins.'
            : 'Add, remove, reorder, and configure phases before tournament play begins. Structural changes to a phase with a started player meeting reset its seating.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <TournamentPhaseEditor
              disabled={locked || busy}
              phases={phaseForms}
              onChange={setPhaseForms}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={locked || busy}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save phases
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
