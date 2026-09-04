import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { useManagedConvention } from '../convention-manager-context'
import { BadgeGatingCard } from './badge-gating-card'
import { ConventionDangerZoneCard } from './convention-danger-zone-card'
import { ConventionLifecycleCard } from './convention-lifecycle-card'
import { ConventionPayoutCard } from './convention-payout-card'
import { ConventionSettingsCard } from './convention-settings-card'
import { isConventionLocked } from './is-convention-locked'
import { RefundPolicyCard } from './refund-policy-card'
import { TicketTypesCard } from './ticket-types-card'
import {
  TournamentLifecycleBadge,
  TournamentVisibilityBadge,
} from '@/components/tournaments'
import { Skeleton } from '@/components/ui/skeleton'

export function ConventionSettingsView() {
  const { publicCode } = useManagedConvention()
  const managed = useQuery(api.conventions.lifecycle.getManagedConvention, {
    publicCode,
  })

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
      <div className="flex items-center gap-2">
        <TournamentLifecycleBadge lifecycle={convention.lifecycle} />
        <TournamentVisibilityBadge visibility={convention.visibility} />
      </div>
      {isConventionLocked(convention) ? (
        <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {convention.lifecycle === 'cancelled'
            ? 'This convention has been cancelled. Its settings can no longer be changed.'
            : 'Settings are locked once the convention is over. Visibility can still be changed.'}
        </p>
      ) : null}
      <ConventionSettingsCard key={convention._id} convention={convention} />
      <BadgeGatingCard convention={convention} />
      <TicketTypesCard convention={convention} />
      <RefundPolicyCard
        key={`${convention._id}-refund-policy`}
        convention={convention}
      />
      <ConventionPayoutCard convention={convention} />
      <ConventionLifecycleCard convention={convention} />
      <ConventionDangerZoneCard convention={convention} />
    </section>
  )
}
