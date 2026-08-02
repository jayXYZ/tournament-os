import { Badge } from '@/components/ui/badge'

// One badge per match outcome, shared by every surface that lists a player's
// results (player-controller match history, public profile match log) so the
// same result never shows different severity colors across surfaces. Each
// outcome gets a distinct variant: win primary, loss destructive, draw
// secondary, pending outline.
export function ResultBadge({
  result,
}: {
  result: 'win' | 'loss' | 'draw' | 'pending'
}) {
  switch (result) {
    case 'win':
      return <Badge>Win</Badge>
    case 'loss':
      return <Badge variant="destructive">Loss</Badge>
    case 'draw':
      return <Badge variant="secondary">Draw</Badge>
    case 'pending':
      return <Badge variant="outline">Pending</Badge>
  }
}
