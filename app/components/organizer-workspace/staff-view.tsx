import type { FormEvent } from "react";
import { Users } from "lucide-react";

import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { BusyState, InvitationRow, MemberRow, Role } from "./types";

export function StaffView({
  activeMembership,
  busy,
  inviteEmail,
  invitations,
  inviteRole,
  mayInvite,
  members,
  onInvite,
  onInviteEmailChange,
  onInviteRoleChange,
}: {
  activeMembership: Doc<"organizationMemberships"> | null;
  busy: BusyState;
  inviteEmail: string;
  invitations: InvitationRow[] | undefined;
  inviteRole: Role;
  mayInvite: boolean;
  members: MemberRow[] | undefined;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onInviteEmailChange: (email: string) => void;
  onInviteRoleChange: (role: Role) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section className="grid gap-4">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h1 className="text-3xl font-semibold tracking-normal">Staff</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Mirrored organization memberships for the selected workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1">
            {(members ?? []).map((member) => (
              <div
                key={member._id}
                className="grid gap-2 border-b border-border py-3 last:border-b-0 sm:grid-cols-[1fr_auto_auto]"
              >
                <span className="text-sm font-medium">
                  {member.email ?? member.workosUserId ?? "Pending user"}
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
            {members === undefined && <Skeleton className="h-20" />}
          </CardContent>
        </Card>
      </section>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Current access</CardTitle>
            <CardDescription className="capitalize">
              {activeMembership?.role ?? "No org"}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite staff</CardTitle>
            <CardDescription>
              Owners and admins can invite staff to this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                  <Input
                    id="invite-email"
                    value={inviteEmail}
                    onChange={(event) => onInviteEmailChange(event.target.value)}
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
                    onValueChange={(value) => onInviteRoleChange(value as Role)}
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
                <Button type="submit" disabled={!mayInvite || busy === "invite"}>
                  {busy === "invite" ? <Spinner data-icon="inline-start" /> : null}
                  Send invitation
                </Button>
                {!mayInvite && (
                  <FieldDescription>
                    Only owners and admins can invite organizer staff.
                  </FieldDescription>
                )}
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
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
              <p className="text-sm text-muted-foreground">
                No invitations sent.
              </p>
            )}
            {invitations === undefined && <Skeleton className="h-16" />}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
