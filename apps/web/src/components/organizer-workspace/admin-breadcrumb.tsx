import { Link, useLocation } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { AdminView } from './types'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Skeleton } from '@/components/ui/skeleton'

const viewLabels: Record<AdminView, string> = {
  tournaments: 'Tournaments',
  conventions: 'Conventions',
  staff: 'Staff',
  organization: 'Organization',
}

const tournamentPageLabels: Record<string, string> = {
  registrations: 'Registrations',
  pairings: 'Pairings',
  timer: 'Timer',
  standings: 'Standings',
  log: 'Activity',
  settings: 'Settings',
}

const conventionPageLabels: Record<string, string> = {
  registrations: 'Registrations',
  events: 'Events',
  settings: 'Settings',
  log: 'Log',
}

export function viewFromPathname(pathname: string): AdminView {
  if (pathname.startsWith('/admin/conventions')) {
    return 'conventions'
  }
  if (pathname.startsWith('/admin/staff')) {
    return 'staff'
  }
  if (pathname.startsWith('/admin/organization')) {
    return 'organization'
  }
  return 'tournaments'
}

export function AdminBreadcrumb() {
  const pathname = useLocation().pathname
  const tournamentMatch = pathname.match(
    /^\/admin\/tournaments\/([^/]+)(?:\/([^/]+))?/,
  )

  if (tournamentMatch) {
    return (
      <TournamentBreadcrumb
        publicCode={tournamentMatch[1]}
        segment={tournamentMatch[2]}
      />
    )
  }

  const conventionMatch = pathname.match(
    /^\/admin\/conventions\/([^/]+)(?:\/([^/]+))?/,
  )

  if (conventionMatch) {
    return (
      <ConventionBreadcrumb
        publicCode={conventionMatch[1]}
        segment={conventionMatch[2]}
      />
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>
            {viewLabels[viewFromPathname(pathname)]}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function TournamentBreadcrumb({
  publicCode,
  segment,
}: {
  publicCode: string
  segment?: string
}) {
  const managed = useQuery(api.tournaments.lifecycle.getManagedTournament, {
    publicCode,
  })
  return (
    <ManagedEventBreadcrumb
      listTo="/admin"
      listLabel="Tournaments"
      loading={managed === undefined}
      name={managed?.tournament.name}
      base={`/admin/tournaments/${publicCode}`}
      pageLabel={segment ? tournamentPageLabels[segment] : undefined}
    />
  )
}

function ConventionBreadcrumb({
  publicCode,
  segment,
}: {
  publicCode: string
  segment?: string
}) {
  const managed = useQuery(api.conventions.lifecycle.getManagedConvention, {
    publicCode,
  })
  return (
    <ManagedEventBreadcrumb
      listTo="/admin/conventions"
      listLabel="Conventions"
      loading={managed === undefined}
      name={managed?.convention.name}
      base={`/admin/conventions/${publicCode}`}
      pageLabel={segment ? conventionPageLabels[segment] : undefined}
    />
  )
}

// The trail both managed-event breadcrumbs share: list link, then
// the event name (skeleton while loading, "Not found", a link when a page
// label follows, or the current page), then the optional page label.
function ManagedEventBreadcrumb({
  listTo,
  listLabel,
  loading,
  name,
  base,
  pageLabel,
}: {
  listTo: string
  listLabel: string
  loading: boolean
  name: string | undefined
  base: string
  pageLabel?: string
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to={listTo}>{listLabel}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {loading ? (
            <Skeleton className="h-4 w-28" />
          ) : name === undefined ? (
            <BreadcrumbPage>Not found</BreadcrumbPage>
          ) : pageLabel ? (
            <BreadcrumbLink asChild>
              <Link to={base} className="max-w-48 truncate">
                {name}
              </Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="max-w-48 truncate">
              {name}
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {pageLabel && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
