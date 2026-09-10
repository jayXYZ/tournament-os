import { useLocation, useSearch } from '@tanstack/react-router'

import type { WorkspaceSubnavItem } from '@/components/shared/workspace-subnav'
import { WorkspaceSubnav } from '@/components/shared/workspace-subnav'
import { parseRoundSelectionSearch } from '@/components/tournaments'

export function TournamentManagerSubnav({
  publicCode,
}: {
  publicCode: string
}) {
  const pathname = useLocation().pathname
  const search = parseRoundSelectionSearch(useSearch({ strict: false }))
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
    { label: 'Overview', href: base },
    { label: 'Registrations', href: `${base}/registrations` },
    {
      label: 'Pairings',
      href: pairingsPath,
      search: pathname === pairingsPath ? {} : selectedRoundSearch,
    },
    { label: 'Timer', href: `${base}/timer` },
    {
      label: 'Standings',
      href: standingsPath,
      search: pathname === standingsPath ? {} : selectedRoundSearch,
    },
    { label: 'Activity', href: `${base}/log` },
    { label: 'Settings', href: `${base}/settings` },
  ]

  return <WorkspaceSubnav aria-label="Tournament sections" items={items} />
}
