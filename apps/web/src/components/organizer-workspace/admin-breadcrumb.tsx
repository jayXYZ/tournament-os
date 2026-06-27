import { Link, useLocation  } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
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
  staff: 'Staff',
  organization: 'Organization',
}

const tournamentPageLabels: Record<string, string> = {
  registrations: 'Registrations',
  pairings: 'Pairings',
  standings: 'Standings',
}

function viewFromPathname(pathname: string): AdminView {
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

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Admin</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
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
  const name = managed?.tournament.name
  const pageLabel = segment ? tournamentPageLabels[segment] : undefined
  const base = `/admin/tournaments/${publicCode}`

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Admin</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Tournaments</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {managed === undefined ? (
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
