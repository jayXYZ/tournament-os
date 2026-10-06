import {
  ClipboardList,
  LayoutDashboard,
  ScrollText,
  Settings,
  Swords,
  Timer,
  Trophy,
} from 'lucide-react'
import { useLocation, useSearch } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { WorkspaceSubnavItem } from '@/components/shared/workspace-subnav'
import { WorkspaceSubnav } from '@/components/shared/workspace-subnav'
import { parseRoundSelectionSearch } from '@/components/tournaments'

// The Registrations tab's notification: applications awaiting a decision.
// The subnav renders before the layout has resolved the public code to an
// id, so the count is skipped (and the pill absent) until the id arrives.
function usePendingReviewNotification(
  tournamentId: Id<'tournaments'> | undefined,
): WorkspaceSubnavItem['notification'] {
  const pending = useQuery(
    api.tournaments.registrations.getPendingReviewCount,
    tournamentId === undefined ? 'skip' : { tournamentId },
  )
  if (pending === undefined || pending.count === 0) {
    return undefined
  }
  const count = pending.capped ? `${pending.count}+` : String(pending.count)
  return {
    count,
    label: `${count} registrations awaiting review`,
  }
}

export function TournamentManagerSubnav({
  publicCode,
  tournamentId,
}: {
  publicCode: string
  tournamentId: Id<'tournaments'> | undefined
}) {
  const pathname = useLocation().pathname
  const search = parseRoundSelectionSearch(useSearch({ strict: false }))
  const pendingReview = usePendingReviewNotification(tournamentId)
  const base = `/admin/tournaments/${publicCode}`
  const pairingsPath = `${base}/pairings`
  const standingsPath = `${base}/standings`
  // Only an explicit round is portable between these views. Player meetings
  // belong to Pairings, while an empty search intentionally selects the latest
  // round available to the destination view.
  const selectedRoundSearch =
    (pathname !== pairingsPath && pathname !== standingsPath) ||
    search.round === undefined
      ? {}
      : {
          ...(search.phase === undefined ? {} : { phase: search.phase }),
          round: search.round,
        }
  const items: Array<WorkspaceSubnavItem> = [
    { label: 'Overview', href: base, icon: LayoutDashboard },
    {
      label: 'Registrations',
      href: `${base}/registrations`,
      icon: ClipboardList,
      notification: pendingReview,
    },
    {
      label: 'Pairings',
      href: pairingsPath,
      icon: Swords,
      search: pathname === pairingsPath ? {} : selectedRoundSearch,
    },
    { label: 'Timer', href: `${base}/timer`, icon: Timer },
    {
      label: 'Standings',
      href: standingsPath,
      icon: Trophy,
      search: pathname === standingsPath ? {} : selectedRoundSearch,
    },
    { label: 'Log', href: `${base}/log`, icon: ScrollText },
    { label: 'Settings', href: `${base}/settings`, icon: Settings },
  ]

  return <WorkspaceSubnav aria-label="Tournament sections" items={items} />
}
