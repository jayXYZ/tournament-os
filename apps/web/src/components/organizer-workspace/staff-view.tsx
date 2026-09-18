import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Users } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { canInviteMembers } from '@paper-pairings/shared/organizer-utils'
import { useOrganization } from './organization-context'
import type { OrganizerInviteRole } from '@paper-pairings/shared/organizer-utils'
import type { FormEvent } from 'react'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function StaffView() {
  const { selectedOrganizationId, selectedOrganization } = useOrganization()
  const inviteMember = useMutation(api.organizations.inviteMember)

  const members = useQuery(
    api.organizations.listMembers,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  const invitations = useQuery(
    api.organizations.listInvitations,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )

  const activeMembership = selectedOrganization?.membership ?? null
  const mayInvite = activeMembership
    ? canInviteMembers(activeMembership.role)
    : false

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrganizerInviteRole>('staff')
  const { busy, run } = useBusyAction()

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrganizationId) {
      return
    }

    await run(async () => {
      await inviteMember({
        organizationId: selectedOrganizationId,
        email: inviteEmail,
        role: inviteRole,
      })
      setInviteEmail('')
      setInviteRole('staff')
      toast.success('Invitation sent.')
    }, 'Could not send invitation.')
  }

  return (
    <div className="flex flex-col gap-6">
      <WorkspacePageHeader title="Staff" />

      <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-medium">Members</h2>
            <p className="text-xs/relaxed text-muted-foreground">
              Mirrored organization memberships for the selected workspace.
            </p>
          </div>
          {/* The member list frames itself like a table so it reads as the
              page's main content rather than as a boxed aside. */}
          <div className="divide-y divide-border rounded-lg border border-border">
            {(members ?? []).map((member) => (
              <div
                key={member._id}
                className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto_auto]"
              >
                <span className="text-sm font-medium">
                  {member.email ?? 'Pending user'}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {member.role}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {member.status}
                </span>
              </div>
            ))}
            {members?.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Users />
                  </EmptyMedia>
                  <EmptyTitle>No members mirrored yet</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
            {members === undefined && <Skeleton className="m-3 h-20" />}
          </div>
        </section>

        <aside className="flex flex-col divide-y divide-border [&>*+*]:pt-6">
          <section className="pb-6">
            <h2 className="text-sm font-medium">Current access</h2>
            <p className="text-xs/relaxed capitalize text-muted-foreground">
              {activeMembership?.role ?? 'No org'}
            </p>
          </section>

          <section className="flex flex-col gap-4 pb-6">
            <div>
              <h2 className="text-sm font-medium">Invite staff</h2>
              <p className="text-xs/relaxed text-muted-foreground">
                Owners and admins can invite staff to this workspace.
              </p>
            </div>
            <form onSubmit={handleInvite}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                  <Input
                    id="invite-email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="judge@example.com"
                    type="email"
                    disabled={!mayInvite}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>Role</FieldLabel>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) =>
                      setInviteRole(value as OrganizerInviteRole)
                    }
                    disabled={!mayInvite}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Button type="submit" disabled={!mayInvite || busy}>
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  Send invitation
                </Button>
                {!mayInvite && (
                  <FieldDescription>
                    Only owners and admins can invite organizer staff.
                  </FieldDescription>
                )}
              </FieldGroup>
            </form>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">Invitations</h2>
            {(invitations ?? []).map((invitation) => (
              <div key={invitation._id} className="border-b border-border pb-3">
                <p className="truncate text-sm font-medium">
                  {invitation.email}
                </p>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  {invitation.role} · {invitation.status}
                </p>
              </div>
            ))}
            {invitations?.length === 0 && (
              <p className="text-xs/relaxed text-muted-foreground">
                No invitations sent.
              </p>
            )}
            {invitations === undefined && <Skeleton className="h-16" />}
          </section>
        </aside>
      </div>
    </div>
  )
}
