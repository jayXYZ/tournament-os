import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FormEvent } from 'react'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import type {
  RoundConfigurationValue,
  TournamentBasicsValue,
} from '@/components/tournaments'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import {
  RoundConfigurationFields,
  TournamentBasicsFields,
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
  toDatetimeLocalValue,
  tournamentVisibilities,
} from '@/components/tournaments'
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

type PhaseStatus = Doc<'tournamentPhases'>['phaseStatus']

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
    tournament.lifecycle === 'in_progress' ||
    tournament.lifecycle === 'completed' ||
    tournament.lifecycle === 'cancelled'
  )
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
      <WorkspacePageHeader
        eyebrow="Tournament manager"
        title="Overview"
        metadata={
          setup ? (
            <div className="flex items-center gap-2">
              <TournamentLifecycleBadge
                lifecycle={setup.tournament.lifecycle}
              />
              <TournamentVisibilityBadge
                visibility={setup.tournament.visibility}
              />
            </div>
          ) : null
        }
      />

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

  const [basics, setBasics] = useState<TournamentBasicsValue>({
    name: tournament.name,
    playerCapacity: String(tournament.playerCapacity),
    startDateTime: toDatetimeLocalValue(tournament.startDate),
  })
  const [busy, setBusy] = useState(false)

  const locked = isSetupLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusy(true)
    try {
      await updateTournamentSetup({
        tournamentId: tournament._id,
        name: basics.name,
        startDate: new Date(basics.startDateTime).getTime(),
        playerCapacity: Number.parseInt(basics.playerCapacity, 10),
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
          <div className="flex items-center gap-2">
            <VisibilitySelect tournament={tournament} />
            <PublishTournamentButton tournament={tournament} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <TournamentBasicsFields
              disabled={disabled}
              idPrefix="overview"
              value={basics}
              onChange={setBasics}
            />

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

function VisibilitySelect({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateVisibility = useMutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
  )
  const [busy, setBusy] = useState(false)

  async function handleChange(visibility: Doc<'tournaments'>['visibility']) {
    if (visibility === tournament.visibility) {
      return
    }
    setBusy(true)
    try {
      await updateVisibility({ tournamentId: tournament._id, visibility })
      toast.success(
        `Visibility set to ${tournamentVisibilities[visibility].label.toLowerCase()}.`,
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not update visibility.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Select
      disabled={busy}
      value={tournament.visibility}
      onValueChange={(value) =>
        void handleChange(value as Doc<'tournaments'>['visibility'])
      }
    >
      <SelectTrigger aria-label="Tournament visibility">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(
            Object.entries(tournamentVisibilities) as Array<
              [
                Doc<'tournaments'>['visibility'],
                (typeof tournamentVisibilities)[keyof typeof tournamentVisibilities],
              ]
            >
          ).map(([value, { label, description }]) => (
            <SelectItem key={value} value={value}>
              {label}
              <span className="text-muted-foreground"> — {description}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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

  if (tournament.lifecycle !== 'setup') {
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
              Publishing opens registration. Who can see the event is
              controlled by its visibility setting: public events appear in
              listings, unlisted events are reachable by link, and private
              events stay hidden.
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

  const [roundConfiguration, setRoundConfiguration] =
    useState<RoundConfigurationValue>({
      roundMode: phase.phaseRoundMode,
      totalRounds:
        phase.phaseTotalRounds === null ? '' : String(phase.phaseTotalRounds),
    })
  const [busy, setBusy] = useState(false)

  const locked = isSetupLocked(tournament)
  const disabled = locked || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusy(true)
    try {
      await updatePhaseSetup({
        phaseId: phase._id,
        phaseRoundMode: roundConfiguration.roundMode,
        phaseTotalRounds:
          roundConfiguration.roundMode === 'fixed'
            ? Number.parseInt(roundConfiguration.totalRounds, 10)
            : undefined,
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

        <RoundConfigurationFields
          disabled={disabled}
          idPrefix={phase._id}
          value={roundConfiguration}
          onChange={setRoundConfiguration}
          showDynamicDescription
        />

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
