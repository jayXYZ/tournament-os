"use client";

import { useState, type FormEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { Users } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { canInviteMembers } from "@/lib/organizer-utils";
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
import { useOrganization } from "./organization-context";
import type { Role } from "./types";

export function StaffView() {
  const { selectedOrganizationId, selectedOrganization } = useOrganization();
  const inviteMember = useAction(api.organizations.inviteMember);

  const members = useQuery(
    api.organizations.listMembers,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );
  const invitations = useQuery(
    api.organizations.listInvitations,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );

  const activeMembership = selectedOrganization?.membership ?? null;
  const mayInvite = activeMembership
    ? canInviteMembers(activeMembership.role)
    : false;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [busy, setBusy] = useState(false);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy(true);
    try {
      await inviteMember({
        organizationId: selectedOrganizationId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteRole("staff");
      toast.success("Invitation sent.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send invitation.",
      );
    } finally {
      setBusy(false);
    }
  }

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
                    onValueChange={(value) => setInviteRole(value as Role)}
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
