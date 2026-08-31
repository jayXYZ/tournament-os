import { useState } from 'react'
import { describeCurrentMatch } from '@paper-pairings/core'
import { Hourglass, Swords } from 'lucide-react'

import { ReportResultDialog } from './report-result-dialog'
import type {
  CurrentMatchDescription,
  MyCurrentMatch,
} from '@paper-pairings/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

// Renders the shared Player View description (see @paper-pairings/core
// player-view.ts) — state branching and copy live in the presenter, this
// file owns only the web styling and the report dialog wiring.
export function CurrentMatchCard({
  currentMatch,
}: {
  currentMatch: MyCurrentMatch | undefined
}) {
  const description = describeCurrentMatch(currentMatch)

  if (description.kind === 'loading') {
    return <Skeleton className="h-56" />
  }

  if (description.kind === 'status') {
    return (
      <StatusEmpty
        icon={description.icon === 'hourglass' ? Hourglass : Swords}
        title={description.title}
        description={description.body}
      />
    )
  }

  return <DescriptionCard description={description} />
}

function DescriptionCard({
  description,
}: {
  description: Extract<CurrentMatchDescription, { kind: 'card' }>
}) {
  const [reporting, setReporting] = useState(false)
  const { action } = description

  return (
    <Card>
      <CardHeader>
        <CardDescription>{description.label}</CardDescription>
        <CardTitle className="text-2xl">
          {description.title}
          {description.subtitle ? (
            <span className="block text-base font-normal text-muted-foreground">
              {description.subtitle}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {description.body ? (
          <p className="text-sm text-muted-foreground">{description.body}</p>
        ) : null}
        {description.scoreline ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xl font-semibold">{description.scoreline}</p>
            {description.badge ? (
              <Badge variant={description.badge.tone}>
                {description.badge.label}
              </Badge>
            ) : null}
          </div>
        ) : null}
        {description.note ? (
          <p className="text-sm text-muted-foreground">{description.note}</p>
        ) : null}
        {action ? (
          <>
            <Button type="button" size="lg" onClick={() => setReporting(true)}>
              Report result
            </Button>
            {reporting ? (
              <ReportResultDialog
                matchId={action.matchId}
                bestOf={action.bestOf}
                opponentName={action.opponentName}
                open={reporting}
                onOpenChange={setReporting}
              />
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StatusEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Swords
  title: string
  description: string
}) {
  return (
    <Empty className="min-h-60 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
