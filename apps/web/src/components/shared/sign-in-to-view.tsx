import { LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useAppAuth } from '@/lib/use-app-auth'

// For a signed-out viewer whose event lookup answered null. A private event
// answers null to anyone it doesn't admit, so the event is not known to be
// missing: signing in may open it, and the sign-in returns to this page
// (useAppAuth's refreshAuth). Signed-in viewers get the not-found state
// instead.
export function SignInToViewEvent({ className }: { className?: string }) {
  const { refreshAuth } = useAppAuth()
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LogIn aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Sign in to view this event</EmptyTitle>
        <EmptyDescription>
          This may be a private event. Sign in to see it, or check the link with
          the organizer.
        </EmptyDescription>
      </EmptyHeader>
      <Button
        type="button"
        onClick={() => void refreshAuth({ ensureSignedIn: true })}
      >
        <LogIn data-icon="inline-start" />
        Sign in
      </Button>
    </Empty>
  )
}
