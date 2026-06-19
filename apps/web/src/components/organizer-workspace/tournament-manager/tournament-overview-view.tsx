import {  useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type {FormEvent} from 'react';
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type TournamentStatus = Doc<'tournaments'>['status']
type PhaseStatus = Doc<'tournamentPhases'>['phaseStatus']
type PhaseRoundMode = Doc<'tournamentPhases'>['phaseRoundMode']

const tournamentStatusBadgeVariant: Record<
  TournamentStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  private: 'outline',
  public: 'default',
  in_progress: 'default',
  completed: 'secondary',
  cancelled: 'destructive',
}

const phaseStatusBadgeVariant: Record<
  PhaseStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  upcoming: 'outline',
  in_progress: 'default',
  completed: 'secondary',
  cancelled: 'destructive',
}

function isSetupLocked(tournament: Doc<'tournaments'>) {
  return (
    tournament.status === 'in_progress' ||
    tournament.status === 'completed' ||
    tournament.status === 'cancelled'
  )
}

function toDatetimeLocalValue(timestamp: number) {
  const offsetMs = new Date(timestamp).getTimezoneOffset() * 60_000
  return new Date(timestamp - offsetMs).toISOString().slice(0, 16)
}

export function TournamentOverviewView({
  tournamentId,
}: {
  tournamentId: string
}) {
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Tournament manager
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">Overview</h1>
          {setup ? (
            <Badge
              variant={tournamentStatusBadgeVariant[setup.tournament.status]}
              className="capitalize"
            >
              {setup.tournament.status.replace(/_/g, ' ')}
            </Badge>
          ) : null}
        </div>
      </div>

      {setup === undefined ? (
        <OverviewSkeleton />
      ) : (
        <>
          <TournamentSettingsCard
            key={setup.tournament._id}
            tournament={setup.tournament}
          />
          <PhaseSettingsCard
            tournament={setup.tournament}
            phases={setup.phases}
          />
        </>
      )}
    </section>
  )
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
    </div>
  )
}

function TournamentSettingsCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateTournamentSetup = useMutation(
    api.tournaments.lifecycle.updateTournamentSetup,
  )

  const [name, setName] = useState(tournament.name)
  const [startDateTime, setStartDateTime] = useState(
    toDatetimeLocalValue(tournament.startDate),
  )
  const [playerCapacity, setPlayerCapacity] = useState(
    String(tournament.playerCapacity),
  )
  const [busy, setBusy] = useState(false)

  const locked = isSetupLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusy(true)
    try {
      await updateTournamentSetup({
        tournamentId: tournament._id,
        name,
        startDate: new Date(startDateTime).getTime(),
        playerCapacity: Number.parseInt(playerCapacity, 10),
      })
      toast.success('Tournament settings saved.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save tournament settings.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament settings</CardTitle>
        <CardDescription>
          {locked
            ? 'Setup is locked once the tournament starts.'
            : 'Update the basic details for this tournament.'}
        </CardDescription>
        <CardAction>
          <PublishTournamentButton tournament={tournament} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_120px]">
              <Field>
                <FieldLabel htmlFor="overview-name">Name</FieldLabel>
                <Input
                  id="overview-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Store Championship"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="overview-start">Start date</FieldLabel>
                <Input
                  id="overview-start"
                  value={startDateTime}
                  onChange={(event) => setStartDateTime(event.target.value)}
                  type="datetime-local"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="overview-capacity">Capacity</FieldLabel>
                <Input
                  id="overview-capacity"
                  value={playerCapacity}
                  onChange={(event) => setPlayerCapacity(event.target.value)}
                  type="number"
                  min={2}
                  max={512}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>

            <FieldSet>
              <FieldLegend>Coming soon</FieldLegend>
              <FieldDescription>
                These settings are not available yet.
              </FieldDescription>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="overview-entry-cost">
                      Entry cost
                    </FieldLabel>
                    <Input
                      id="overview-entry-cost"
                      type="number"
                      placeholder="$0.00"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="overview-registration-deadline">
                      Registration deadline
                    </FieldLabel>
                    <Input
                      id="overview-registration-deadline"
                      type="datetime-local"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="overview-venue">Venue</FieldLabel>
                    <Input
                      id="overview-venue"
                      placeholder="Add a location"
                      disabled
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="overview-description">
                    Event description
                  </FieldLabel>
                  <Textarea
                    id="overview-description"
                    placeholder="Tell players what to expect at this event."
                    disabled
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <div className="flex justify-end">
              <Button type="submit" disabled={disabled}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save settings
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function PublishTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const publishTournament = useMutation(
    api.tournaments.lifecycle.publishTournament,
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (tournament.status !== 'private') {
    return null
  }

  async function handlePublish() {
    setBusy(true)
    try {
      await publishTournament({ tournamentId: tournament._id })
      setConfirming(false)
      toast.success('Tournament published.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not publish tournament.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setConfirming(true)}
      >
        <Globe data-icon="inline-start" />
        Publish
      </Button>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirming(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Globe />
            </AlertDialogMedia>
            <AlertDialogTitle>Publish {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Publishing lists this tournament publicly so players can find it
              and register.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handlePublish()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PhaseSettingsCard({
  tournament,
  phases,
}: {
  tournament: Doc<'tournaments'>
  phases: Array<Doc<'tournamentPhases'>>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Phase settings</CardTitle>
        <CardDescription>
          Configure how each phase of this tournament runs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {phases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No phases have been configured for this tournament.
          </p>
        ) : (
          <Tabs defaultValue={phases[0]._id}>
            <TabsList>
              {phases.map((phase) => (
                <TabsTrigger key={phase._id} value={phase._id}>
                  {phase.phaseName ?? `Phase ${phase.phaseOrder}`}
                </TabsTrigger>
              ))}
            </TabsList>
            {phases.map((phase) => (
              <TabsContent key={phase._id} value={phase._id} className="pt-2">
                <PhaseSettingsForm tournament={tournament} phase={phase} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}

function PhaseSettingsForm({
  tournament,
  phase,
}: {
  tournament: Doc<'tournaments'>
  phase: Doc<'tournamentPhases'>
}) {
  const updatePhaseSetup = useMutation(
    api.tournaments.lifecycle.updatePhaseSetup,
  )

  const [roundMode, setRoundMode] = useState<PhaseRoundMode>(
    phase.phaseRoundMode,
  )
  const [totalRounds, setTotalRounds] = useState(
    phase.phaseTotalRounds === null ? '' : String(phase.phaseTotalRounds),
  )
  const [busy, setBusy] = useState(false)

  const locked = isSetupLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusy(true)
    try {
      await updatePhaseSetup({
        phaseId: phase._id,
        phaseRoundMode: roundMode,
        phaseTotalRounds:
          roundMode === 'fixed' ? Number.parseInt(totalRounds, 10) : undefined,
      })
      toast.success('Phase settings saved.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save phase settings.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {phase.phaseType}
          </Badge>
          <Badge
            variant={phaseStatusBadgeVariant[phase.phaseStatus]}
            className="capitalize"
          >
            {phase.phaseStatus.replace(/_/g, ' ')}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_120px]">
          <Field>
            <FieldLabel>Rounds</FieldLabel>
            <Select
              value={roundMode}
              onValueChange={(value) => setRoundMode(value as PhaseRoundMode)}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="dynamic">Dynamic rounds</SelectItem>
                  <SelectItem value="fixed">Fixed rounds</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Dynamic rounds are calculated from the number of active players
              when the phase starts.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${phase._id}-total-rounds`}>
              Total rounds
            </FieldLabel>
            <Input
              id={`${phase._id}-total-rounds`}
              value={totalRounds}
              onChange={(event) => setTotalRounds(event.target.value)}
              type="number"
              min={1}
              max={16}
              disabled={disabled || roundMode === 'dynamic'}
              required={roundMode === 'fixed'}
            />
          </Field>
        </div>

        <FieldSet>
          <FieldLegend>Coming soon</FieldLegend>
          <FieldDescription>
            These phase settings are not available yet.
          </FieldDescription>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Cutoff</FieldLabel>
              <Select disabled>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Top X players" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="top_X_players">Top X players</SelectItem>
                    <SelectItem value="X_points_or_more">
                      X points or more
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${phase._id}-round-time`}>
                Round time limit
              </FieldLabel>
              <Input
                id={`${phase._id}-round-time`}
                placeholder="50 minutes"
                disabled
              />
            </Field>
          </div>
        </FieldSet>

        <div className="flex justify-end">
          <Button type="submit" disabled={disabled}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Save phase
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
