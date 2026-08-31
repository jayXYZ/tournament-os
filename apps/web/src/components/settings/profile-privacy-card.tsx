import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useBusyAction } from '@/hooks/use-busy-action'

export function ProfilePrivacyCard({ me }: { me: Doc<'users'> }) {
  const updateSettings = useMutation(api.users.updateMyProfileSettings)
  const { busy, run } = useBusyAction()

  // A missing value means "public" (legacy rows); only explicit "private"
  // hides anything — mirrors the backend's read rule.
  const profileVisible = me.profileVisibility !== 'private'
  const historyVisible = me.historyVisibility !== 'private'

  async function handleProfileVisibility(checked: boolean) {
    await run(async () => {
      await updateSettings({
        profileVisibility: checked ? 'public' : 'private',
      })
      toast.success(
        checked
          ? 'Your profile is now public.'
          : 'Your profile is now hidden from everyone but you.',
      )
    }, 'Could not update profile visibility.')
  }

  async function handleHistoryVisibility(checked: boolean) {
    await run(async () => {
      await updateSettings({
        historyVisibility: checked ? 'public' : 'private',
      })
      toast.success(
        checked
          ? 'Your tournament history is now visible on your profile.'
          : 'Your tournament history is now hidden from everyone but you.',
      )
    }, 'Could not update history visibility.')
  }

  const historyDisabled = busy || !profileVisible

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile privacy</CardTitle>
        <CardDescription>
          Control what other players see when they open your public profile
          page.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field orientation="horizontal" data-disabled={busy}>
          <FieldContent>
            <FieldLabel htmlFor="settings-profile-visible">
              Public profile
            </FieldLabel>
            <FieldDescription>
              When off, your profile page looks like it does not exist to
              everyone but you.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="settings-profile-visible"
            checked={profileVisible}
            disabled={busy}
            onCheckedChange={(checked) => void handleProfileVisibility(checked)}
            aria-label="Public profile"
          />
        </Field>
        <Separator />
        <Field orientation="horizontal" data-disabled={historyDisabled}>
          <FieldContent>
            <FieldLabel htmlFor="settings-history-visible">
              Show tournament history
            </FieldLabel>
            <FieldDescription>
              When off, your profile stays visible but your past tournament
              results are hidden from everyone but you.
              {profileVisible
                ? ''
                : ' Unavailable while your profile is private.'}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="settings-history-visible"
            checked={historyVisible}
            disabled={historyDisabled}
            onCheckedChange={(checked) => void handleHistoryVisibility(checked)}
            aria-label="Show tournament history"
          />
        </Field>
      </CardContent>
      <CardFooter>
        <Button asChild type="button" variant="outline">
          <Link
            to="/users/$publicCode"
            params={{ publicCode: String(me.publicCode) }}
          >
            <ExternalLink data-icon="inline-start" />
            View public profile
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
