import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { ArrowRight, CalendarDays, Ticket, Trophy } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { useManagedConvention } from './convention-manager-context'
import type { ReactNode } from 'react'
import { formatConventionDateRange } from '@/components/conventions/convention-display'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import {
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
} from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCents } from '@/lib/money'

// One line summarizing the pass lineup (ADR 0004: pricing lives on ticket
// types): "Free badge", "$20.00 badge", or a count with the price range.
function ticketTypeSummary(
  ticketTypes: Array<{ name: string; priceCents: number }> | undefined,
) {
  if (ticketTypes === undefined || ticketTypes.length === 0) {
    return 'No tickets configured'
  }
  if (ticketTypes.length === 1) {
    const only = ticketTypes[0]
    return only.priceCents > 0
      ? `${formatCents(only.priceCents)} badge`
      : 'Free badge'
  }
  const prices = ticketTypes.map((t) => t.priceCents)
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const range =
    high === 0
      ? 'free'
      : low === high
        ? formatCents(low)
        : `${low === 0 ? 'free' : formatCents(low)} – ${formatCents(high)}`
  return `${ticketTypes.length} ticket types · ${range}`
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {detail ? (
        <CardContent className="text-sm text-muted-foreground">
          {detail}
        </CardContent>
      ) : null}
    </Card>
  )
}

export function ConventionOverviewView() {
  const { conventionId, publicCode } = useManagedConvention()
  const managed = useQuery(api.conventions.lifecycle.getManagedConvention, {
    publicCode,
  })
  // Stat only — the events tab paginates the full list; the count query
  // ships one integer ("200+" past its cap) instead of the docs.
  const childEvents = useQuery(api.conventions.events.countChildEvents, {
    conventionId,
  })
  // The public listing carries the name/price pair the summary line needs
  // without the organizer listing's per-type payment-lock probes.
  const ticketTypes = useQuery(
    api.conventions.ticketTypes.listPublicTicketTypes,
    { conventionId },
  )

  if (managed === undefined) {
    return <Skeleton className="h-72" />
  }
  if (managed === null) {
    return (
      <p className="text-sm text-muted-foreground">Convention not found.</p>
    )
  }
  const { convention } = managed

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader
        eyebrow="Convention"
        title={convention.name}
        metadata={
          <span className="flex items-center gap-2">
            <TournamentLifecycleBadge lifecycle={convention.lifecycle} />
            <TournamentVisibilityBadge visibility={convention.visibility} />
          </span>
        }
        actions={
          convention.lifecycle !== 'setup' ? (
            <Button asChild variant="outline">
              <Link
                to="/conventions/$conventionId"
                params={{ conventionId: publicCode }}
              >
                Public page
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<CalendarDays className="size-4" />}
          label="Dates"
          value={formatConventionDateRange(
            convention.startDate,
            convention.endDate,
          )}
        />
        <StatCard
          icon={<Ticket className="size-4" />}
          label="Badges"
          value={`${convention.confirmedRegistrationCount} / ${convention.playerCapacity}`}
          detail={`${ticketTypeSummary(ticketTypes)}${
            convention.badgeRequiredForChildEvents
              ? ' · required for event registration'
              : ''
          }`}
        />
        <StatCard
          icon={<Trophy className="size-4" />}
          label="Events"
          value={
            childEvents === undefined
              ? '…'
              : childEvents.hasMore
                ? `${childEvents.count}+`
                : childEvents.count
          }
          detail={
            <Link
              to="/admin/conventions/$conventionId/events"
              params={{ conventionId: publicCode }}
              className="underline"
            >
              Manage events
            </Link>
          }
        />
      </div>

      {convention.lifecycle === 'setup' ? (
        <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This convention is in setup: it is not publicly visible and badge
          registration is closed. Publish it from Settings when it is ready.
        </p>
      ) : null}
    </section>
  )
}
