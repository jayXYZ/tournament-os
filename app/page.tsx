"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import {
  Building2,
  CheckCircle2,
  LogIn,
  Mail,
  ShieldCheck,
  Sparkles,
  Swords,
  UserRound,
  Users,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  canInviteMembers,
  type InvitationStatus,
  type OrganizerInviteRole,
} from "@/lib/organizer-utils";

type Role = OrganizerInviteRole;

export default function Home() {
  return (
    <main className="min-h-svh bg-stone-950 text-stone-50">
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-emerald-300 border-t-transparent" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutHome />
      </Unauthenticated>
      <Authenticated>
        <OrganizerWorkspace />
      </Authenticated>
    </main>
  );
}

function SignedOutHome() {
  const { refreshAuth } = useAuth();

  return (
    <section className="relative grid min-h-svh overflow-hidden lg:grid-cols-[1fr_440px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.28),transparent_28%),linear-gradient(135deg,rgba(28,25,23,0.4),rgba(12,10,9,0.96))]" />
      <div className="relative flex min-h-svh flex-col justify-between px-6 py-6 sm:px-10 lg:px-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-300 text-stone-950">
              <Swords className="size-5" />
            </div>
            <span className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100">
              Tournament OS
            </span>
          </div>
        </header>

        <div className="max-w-3xl pb-16 pt-20">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-emerald-200">
            Organizer workspaces
          </p>
          <h1 className="max-w-2xl text-5xl font-semibold leading-[1.02] text-white sm:text-6xl lg:text-7xl">
            Run Magic events from one trusted command center.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-stone-300 sm:text-lg">
            Sign in to create an organizer workspace, invite staff, and prepare the account model for events.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              type="button"
              size="lg"
              onClick={() => void refreshAuth({ ensureSignedIn: true })}
              className="h-11 bg-emerald-300 px-4 text-sm text-stone-950 hover:bg-emerald-200"
            >
              <LogIn className="size-4" />
              Sign in
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 border-stone-700 px-4 text-sm text-stone-100 hover:bg-stone-800">
              <a href="/sign-up">
                <Sparkles className="size-4" />
                Create account
              </a>
            </Button>
          </div>
        </div>
      </div>

      <aside className="relative hidden border-l border-white/10 bg-stone-900/80 px-8 py-10 lg:flex lg:flex-col lg:justify-end">
        <div className="space-y-7">
          {[
            ["Identity", "WorkOS AuthKit sessions feed Convex with signed JWTs."],
            ["Organizations", "WorkOS memberships stay authoritative for organizer staff."],
            ["App data", "Convex mirrors only what Tournament OS needs to operate."],
          ].map(([label, value]) => (
            <div key={label} className="border-t border-white/10 pt-5">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-200">
                {label}
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-300">{value}</p>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}

function OrganizerWorkspace() {
  const { user, signOut } = useAuth();
  const upsertMe = useMutation(api.users.upsertMe);
  const organizations = useQuery(api.organizations.listMine);
  const createOrganization = useAction(api.organizations.createOrganizerOrganization);
  const inviteMember = useAction(api.organizations.inviteMember);

  const [explicitOrganizationId, setExplicitOrganizationId] =
    useState<Id<"organizations"> | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"org" | "invite" | null>(null);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  const selectedOrganizationId =
    explicitOrganizationId ?? organizations?.[0]?.organization._id ?? null;

  const selected = useMemo(
    () =>
      organizations?.find(
        (row) => row.organization._id === selectedOrganizationId,
      ) ?? null,
    [organizations, selectedOrganizationId],
  );

  const details = useQuery(
    api.organizations.getById,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );
  const members = useQuery(
    api.organizations.listMembers,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );
  const invitations = useQuery(
    api.organizations.listInvitations,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );

  const activeMembership = details?.membership ?? selected?.membership ?? null;
  const mayInvite = activeMembership ? canInviteMembers(activeMembership.role) : false;

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("org");
    setNotice(null);

    try {
      const result = await createOrganization({ name: organizationName });
      setExplicitOrganizationId(result.organizationId);
      setOrganizationName("");
      setNotice("Organizer workspace created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create organization.");
    } finally {
      setBusy(null);
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy("invite");
    setNotice(null);
    try {
      await inviteMember({
        organizationId: selectedOrganizationId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteRole("staff");
      setNotice("Invitation sent.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send invitation.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-h-svh bg-stone-100 text-stone-950">
      <header className="flex min-h-16 items-center justify-between border-b border-stone-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-stone-950 text-emerald-200">
            <Swords className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Tournament OS</p>
            <p className="mt-1 text-xs text-stone-500">Auth and organizer foundation</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-stone-600 sm:inline">{user?.email}</span>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-stone-200 bg-stone-950 p-4 text-stone-50 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <UserRound className="size-4 text-emerald-200" />
            <div>
              <p className="text-sm font-medium">{user?.firstName ?? "Player account"}</p>
              <p className="text-xs text-stone-400">Global player profile</p>
            </div>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-400">
              Organizer workspaces
            </p>
            <div className="space-y-1">
              {!organizations && <p className="text-sm text-stone-400">Loading...</p>}
              {organizations?.length === 0 && (
                <p className="text-sm leading-6 text-stone-400">No organizer workspaces yet.</p>
              )}
              {organizations?.map(({ organization, membership }) => (
                <button
                  key={organization._id}
                  type="button"
                  onClick={() => setExplicitOrganizationId(organization._id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    selectedOrganizationId === organization._id
                      ? "bg-emerald-300 text-stone-950"
                      : "text-stone-200 hover:bg-white/10"
                  }`}
                >
                  <span className="truncate">{organization.name}</span>
                  <span className="text-xs capitalize">{membership.role}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[1fr_360px]">
            <section className="space-y-6">
              <div className="border-b border-stone-200 pb-6">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
                  Organizer setup
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
                  Create a workspace, invite staff, and keep players separate.
                </h1>
              </div>

              {notice && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <CheckCircle2 className="size-4" />
                  {notice}
                </div>
              )}

              <form
                onSubmit={handleCreateOrganization}
                className="grid gap-3 border-b border-stone-200 pb-6 sm:grid-cols-[1fr_auto]"
              >
                <label className="grid gap-2 text-sm font-medium">
                  New organizer organization
                  <input
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                    placeholder="Example: Main Street Games"
                    required
                  />
                </label>
                <Button
                  type="submit"
                  className="mt-auto h-11 bg-stone-950 px-4 text-stone-50 hover:bg-stone-800"
                  disabled={busy === "org"}
                >
                  <Building2 className="size-4" />
                  Create
                </Button>
              </form>

              <div className="grid gap-4 md:grid-cols-3">
                <Metric label="Organizations" value={organizations?.length ?? 0} icon={Building2} />
                <Metric label="Members" value={members?.length ?? 0} icon={Users} />
                <Metric label="Pending invites" value={pendingInviteCount(invitations)} icon={Mail} />
              </div>

              <section className="grid gap-4">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-emerald-700" />
                  <h2 className="text-lg font-semibold">Members</h2>
                </div>
                <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
                  {(members ?? []).map((member) => (
                    <div
                      key={member._id}
                      className="grid gap-2 border-b border-stone-100 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <span className="text-sm font-medium">
                        {member.email ?? member.workosUserId ?? "Pending user"}
                      </span>
                      <span className="text-xs capitalize text-stone-500">{member.role}</span>
                      <span className="text-xs capitalize text-stone-500">{member.status}</span>
                    </div>
                  ))}
                  {members?.length === 0 && (
                    <p className="px-4 py-6 text-sm text-stone-500">No members mirrored yet.</p>
                  )}
                </div>
              </section>
            </section>

            <aside className="space-y-6">
              <section className="rounded-md border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-700" />
                  <h2 className="text-sm font-semibold">Current access</h2>
                </div>
                <p className="mt-3 text-2xl font-semibold capitalize">
                  {activeMembership?.role ?? "No org"}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {details?.organization.name ?? "Create or select an organizer workspace."}
                </p>
              </section>

              <form onSubmit={handleInvite} className="rounded-md border border-stone-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-emerald-700" />
                  <h2 className="text-sm font-semibold">Invite staff</h2>
                </div>
                <div className="mt-4 grid gap-3">
                  <input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                    placeholder="judge@example.com"
                    type="email"
                    disabled={!mayInvite}
                    required
                  />
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as Role)}
                    className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
                    disabled={!mayInvite}
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button
                    type="submit"
                    disabled={!mayInvite || busy === "invite"}
                    className="h-10 bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    Send invitation
                  </Button>
                </div>
                {!mayInvite && (
                  <p className="mt-3 text-xs leading-5 text-stone-500">
                    Only owners and admins can invite organizer staff.
                  </p>
                )}
              </form>

              <section className="rounded-md border border-stone-200 bg-white p-4">
                <h2 className="text-sm font-semibold">Invitations</h2>
                <div className="mt-3 space-y-3">
                  {(invitations ?? []).map((invitation) => (
                    <div key={invitation._id} className="border-t border-stone-100 pt-3">
                      <p className="truncate text-sm font-medium">{invitation.email}</p>
                      <p className="mt-1 text-xs capitalize text-stone-500">
                        {invitation.role} · {invitation.status}
                      </p>
                    </div>
                  ))}
                  {invitations?.length === 0 && (
                    <p className="text-sm text-stone-500">No invitations sent.</p>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">{label}</p>
        <Icon className="size-4 text-emerald-700" />
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function pendingInviteCount(
  invitations:
    | Array<{
        status: InvitationStatus;
      }>
    | undefined,
) {
  return invitations?.filter((invitation) => invitation.status === "pending").length ?? 0;
}
