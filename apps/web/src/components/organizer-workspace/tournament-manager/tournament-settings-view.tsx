import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Ban, Globe, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { tournamentFormats } from '@tournament-os/shared/tournament-creation-utils'
import type { FormEvent } from 'react'
import type { TournamentFormat } from '@tournament-os/shared/tournament-creation-utils'
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
import { Separator } from '@/components/ui/separator'
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
      <WorkspacePageHeader
        eyebrow="Tournament manager"
        title="Settings"
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
        <SettingsSkeleton />
      ) : (
        <>
          {isSetupLocked(setup.tournament) ? (
            <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              {setup.tournament.lifecycle === 'cancelled'
                ? 'This tournament has been cancelled. Its settings can no longer be changed.'
                : 'Core settings are locked once the tournament starts. Visibility can still be changed at any time.'}
            </p>
          ) : null}
          <TournamentSettingsCard
            key={setup.tournament._id}
            tournament={setup.tournament}
          />
          <PhaseSettingsCard
            tournament={setup.tournament}
            phases={setup.phases}
          />
          <DangerZoneCard tournament={setup.tournament} />
        </>
      )}
    </section>
  )
}

function SettingsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
      <Skeleton className="h-40" />
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
  const [format, setFormat] = useState<TournamentFormat>(tournament.format)
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
        format,
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
              idPrefix="settings"
              value={basics}
              onChange={setBasics}
            />

            <Field>
              <FieldLabel htmlFor="settings-format">Format</FieldLabel>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as TournamentFormat)}
                disabled={disabled}
              >
                <SelectTrigger
                  id="settings-format"
                  className="w-full capitalize"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {tournamentFormats.map((tournamentFormat) => (
                      <SelectItem
                        key={tournamentFormat}
                        value={tournamentFormat}
                        className="capitalize"
                      >
                        {tournamentFormat}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <FieldSet>
              <FieldLegend>Coming soon</FieldLegend>
              <FieldDescription>
                These settings are not available yet.
              </FieldDescription>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="settings-entry-cost">
                      Entry cost
                    </FieldLabel>
                    <Input
                      id="settings-entry-cost"
                      type="number"
                      placeholder="$0.00"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-registration-deadline">
                      Registration deadline
                    </FieldLabel>
                    <Input
                      id="settings-registration-deadline"
                      type="datetime-local"
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-venue">Venue</FieldLabel>
                    <Input
                      id="settings-venue"
                      placeholder="Add a location"
                      disabled
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="settings-description">
                    Event description
                  </FieldLabel>
                  <Textarea
                    id="settings-description"
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
      disabled={busy || tournament.lifecycle === 'cancelled'}
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

function DangerZoneCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancellable =
    tournament.lifecycle !== 'completed' && tournament.lifecycle !== 'cancelled'

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          These actions affect players and cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {cancellable ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1 text-sm">
                <p className="font-medium">Cancel this event</p>
                <p className="text-muted-foreground">
                  Ends the event immediately. Players keep their results, but
                  no further rounds can be played.
                </p>
              </div>
              <CancelTournamentButton tournament={tournament} />
            </div>
            <Separator />
          </>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1 text-sm">
            <p className="font-medium">Delete this event</p>
            <p className="text-muted-foreground">
              Permanently removes the event with all registrations, pairings,
              and standings.
            </p>
          </div>
          <DeleteTournamentButton tournament={tournament} />
        </div>
      </CardContent>
    </Card>
  )
}

function CancelTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancelTournament = useMutation(
    api.tournaments.lifecycle.cancelTournament,
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleCancel() {
    setBusy(true)
    try {
      await cancelTournament({ tournamentId: tournament._id })
      setConfirming(false)
      toast.success('Tournament cancelled.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not cancel tournament.',
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
        <Ban data-icon="inline-start" />
        Cancel event
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
            <AlertDialogMedia className="text-destructive">
              <Ban />
            </AlertDialogMedia>
            <AlertDialogTitle>Cancel {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The event ends immediately and no further rounds can be played.
              Registered players will see the event as cancelled. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handleCancel()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Cancel event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DeleteTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const deleteTournament = useMutation(
    api.tournaments.lifecycle.deleteTournament,
  )
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [busy, setBusy] = useState(false)

  const nameMatches = confirmationName.trim() === tournament.name

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteTournament({ tournamentId: tournament._id })
      toast.success('Tournament deleted.')
      void navigate({ to: '/admin' })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not delete tournament.',
      )
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setConfirmationName('')
          setConfirming(true)
        }}
      >
        <Trash2 data-icon="inline-start" />
        Delete event
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
            <AlertDialogMedia className="text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the event along with every
              registration, pairing, and standing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-confirmation-name">
              Type <span className="font-semibold">{tournament.name}</span> to
              confirm
            </FieldLabel>
            <Input
              id="delete-confirmation-name"
              autoComplete="off"
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              disabled={busy}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || !nameMatches}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
