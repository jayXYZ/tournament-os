import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Ban, Globe, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  toTournamentCreationPhasePayload,
  tournamentFormats,
} from '@tournament-os/shared/tournament-creation-utils'
import type { FormEvent } from 'react'
import type {
  TournamentCreationPhaseForm,
  TournamentFormat,
} from '@tournament-os/shared/tournament-creation-utils'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import type { TournamentBasicsValue } from '@/components/tournaments'
import {
  TournamentBasicsFields,
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
  toDatetimeLocalValue,
  tournamentVisibilities,
} from '@/components/tournaments'
import { TournamentPhaseEditor } from '@/components/tournaments/tournament-phase-editor'
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
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
import { Switch } from '@/components/ui/switch'

function isPreStartLocked(tournament: Doc<'tournaments'>) {
  return (
    tournament.lifecycle !== 'setup' &&
    tournament.lifecycle !== 'registration'
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

function PairingsPublicationCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updatePairingsAutoPublish = useMutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
  )
  const [busy, setBusy] = useState(false)
  const disabled =
    busy ||
    tournament.lifecycle === 'completed' ||
    tournament.lifecycle === 'cancelled'

  async function handleChange(autoPublishPairings: boolean) {
    setBusy(true)
    try {
      await updatePairingsAutoPublish({
        tournamentId: tournament._id,
        autoPublishPairings,
      })
      toast.success(
        autoPublishPairings
          ? 'New pairings will publish automatically.'
          : 'New pairings will wait for organizer approval.',
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not update pairing publication.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pairing publication</CardTitle>
        <CardDescription>
          Choose whether players see each new round as soon as its pairings are
          generated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" data-disabled={disabled}>
          <FieldContent>
            <FieldLabel htmlFor="settings-auto-publish-pairings">
              Publish pairings automatically
            </FieldLabel>
            <FieldDescription>
              When off, the dashboard advance button will ask you to publish
              each round after reviewing it. This only affects newly generated
              rounds.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="settings-auto-publish-pairings"
            checked={tournament.autoPublishPairings}
            disabled={disabled}
            onCheckedChange={(checked) => void handleChange(checked)}
            aria-label="Publish pairings automatically"
          />
        </Field>
      </CardContent>
    </Card>
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

  const locked = isPreStartLocked(tournament)
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
            ? 'Core settings are locked after tournament play begins.'
            : 'Update these details any time before tournament play begins.'}
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

function EventDetailsCard({ tournament }: { tournament: Doc<'tournaments'> }) {
  const updateTournamentDetails = useMutation(
    api.tournaments.lifecycle.updateTournamentDetails,
  )

  const [details, setDetails] = useState(tournament.detailsMarkdown ?? '')
  const [busy, setBusy] = useState(false)

  // Details stay editable after the event starts (prize and logistics info
  // legitimately changes mid-event); only cancelled events are read-only.
  const disabled = tournament.lifecycle === 'cancelled' || busy

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setBusy(true)
    try {
      await updateTournamentDetails({
        tournamentId: tournament._id,
        detailsMarkdown: details,
      })
      toast.success('Event details saved.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save event details.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>
          Description, prizes, and logistics shown on the public event page.
          Editable at any time, even after the event starts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <MarkdownEditor
              value={tournament.detailsMarkdown ?? ''}
              onChange={setDetails}
              disabled={disabled}
              placeholder="Tell players what to expect: schedule, prizes, entry requirements, venue details…"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={disabled}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save details
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function VisibilitySelect({ tournament }: { tournament: Doc<'tournaments'> }) {
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
        error instanceof Error ? error.message : 'Could not update visibility.',
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
              Publishing opens registration. Who can see the event is controlled
              by its visibility setting: public events appear in listings,
              unlisted events are reachable by link, and private events stay
              hidden.
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
  const [busy, setBusy] = useState(false)
  const locked = isPreStartLocked(tournament)
  const existingPhaseIds = new Set(phases.map((phase) => phase._id))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
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
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save tournament phases.',
      )
    } finally {
      setBusy(false)
    }
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

function DangerZoneCard({ tournament }: { tournament: Doc<'tournaments'> }) {
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
                  Ends the event immediately. Players keep their results, but no
                  further rounds can be played.
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
        error instanceof Error ? error.message : 'Could not cancel tournament.',
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
              Registered players will see the event as cancelled. This cannot be
              undone.
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
        error instanceof Error ? error.message : 'Could not delete tournament.',
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
              This permanently deletes the event along with every registration,
              pairing, and standing. This cannot be undone.
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
