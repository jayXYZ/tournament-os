"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Mail,
  Plus,
  ShieldCheck,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  canInviteMembers,
  type InvitationStatus,
  type OrganizerRole,
  type OrganizerInviteRole,
} from "@/lib/organizer-utils";
import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
  type TournamentCreationPhaseForm,
  type TournamentCreationPhaseRoundMode,
} from "@/lib/tournament-creation-utils";

type AdminView = "tournaments" | "staff";
type BusyState = "org" | "invite" | "tournament" | null;
type Role = OrganizerInviteRole;
type MemberRole = OrganizerRole;
type Tournament = Doc<"tournaments">;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function OrganizerWorkspace({ view }: { view: AdminView }) {
  const { user, signOut } = useAuth();
  const upsertMe = useMutation(api.users.upsertMe);
  const organizations = useQuery(api.organizations.listMine);
  const createOrganization = useAction(
    api.organizations.createOrganizerOrganization,
  );
  const inviteMember = useAction(api.organizations.inviteMember);
  const createTournament = useMutation(api.tournaments.createTournamentWithPhases);

  const [explicitOrganizationId, setExplicitOrganizationId] =
    useState<Id<"organizations"> | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentStartDateTime, setTournamentStartDateTime] = useState("");
  const [tournamentPlayerCapacity, setTournamentPlayerCapacity] = useState("32");
  const [tournamentPhases, setTournamentPhases] = useState<
    TournamentCreationPhaseForm[]
  >([createDefaultTournamentCreationPhase("phase-1")]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

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
  const tournaments = useQuery(
    api.tournaments.listUpcomingForOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );
  const members = useQuery(
    api.organizations.listMembers,
    view === "staff" && selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : "skip",
  );
  const invitations = useQuery(
    api.organizations.listInvitations,
    view === "staff" && selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : "skip",
  );

  const activeMembership = details?.membership ?? selected?.membership ?? null;
  const mayInvite = activeMembership
    ? canInviteMembers(activeMembership.role)
    : false;

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
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create organization.",
      );
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
      setNotice(
        error instanceof Error ? error.message : "Could not send invitation.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateTournament(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy("tournament");
    setNotice(null);
    try {
      await createTournament({
        organizationId: selectedOrganizationId,
        name: tournamentName,
        startDate: new Date(tournamentStartDateTime).getTime(),
        playerCapacity: Number.parseInt(tournamentPlayerCapacity, 10),
        phases: toTournamentCreationPhasePayload(tournamentPhases),
      });
      setTournamentName("");
      setTournamentStartDateTime("");
      setTournamentPlayerCapacity("32");
      setTournamentPhases([createDefaultTournamentCreationPhase("phase-1")]);
      setNotice("Tournament created.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create tournament.",
      );
    } finally {
      setBusy(null);
    }
  }

  function handleAddTournamentPhase() {
    setTournamentPhases((current) =>
      addTournamentCreationPhase(current, `phase-${Date.now()}`),
    );
  }

  function handleRemoveTournamentPhase(id: string) {
    setTournamentPhases((current) =>
      removeTournamentCreationPhase(current, id),
    );
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
            <p className="mt-1 text-xs text-stone-500">Organization controls</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Button asChild type="button" variant="outline">
            <Link href="/">
              <ArrowLeft className="size-4" />
              Player view
            </Link>
          </Button>
          <span className="hidden text-sm text-stone-600 md:inline">
            {user?.email}
          </span>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-stone-200 bg-stone-950 p-4 text-stone-50 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <UserRound className="size-4 text-emerald-200" />
            <div>
              <p className="text-sm font-medium">
                {user?.firstName ?? "Player account"}
              </p>
              <p className="text-xs text-stone-400">Global player profile</p>
            </div>
          </div>

          <nav className="mt-4 grid gap-1 border-b border-white/10 pb-4">
            <AdminNavLink active={view === "tournaments"} href="/admin">
              <Trophy className="size-4" />
              Tournaments
            </AdminNavLink>
            <AdminNavLink active={view === "staff"} href="/admin/staff">
              <Users className="size-4" />
              Staff
            </AdminNavLink>
          </nav>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-400">
              Organizer workspaces
            </p>
            <div className="space-y-1">
              {!organizations && <p className="text-sm text-stone-400">Loading...</p>}
              {organizations?.length === 0 && (
                <p className="text-sm leading-6 text-stone-400">
                  No organizer workspaces yet.
                </p>
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

          <form onSubmit={handleCreateOrganization} className="mt-6 grid gap-3">
            <label className="grid gap-2 text-sm font-medium text-stone-100">
              New organization
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                className="h-10 rounded-md border border-white/10 bg-white/10 px-3 text-sm text-stone-50 outline-none transition placeholder:text-stone-500 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/20"
                placeholder="Main Street Games"
                required
              />
            </label>
            <Button
              type="submit"
              className="h-10 bg-emerald-300 text-stone-950 hover:bg-emerald-200"
              disabled={busy === "org"}
            >
              <Building2 className="size-4" />
              Create
            </Button>
          </form>
        </aside>

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto grid max-w-6xl gap-6">
            <section className="space-y-6">
              <div className="border-b border-stone-200 pb-6">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
                  {details?.organization.name ?? "Admin workspace"}
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
                  {view === "staff"
                    ? "Manage organization staff."
                    : "Upcoming organization tournaments."}
                </h1>
              </div>

              {notice && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <CheckCircle2 className="size-4" />
                  {notice}
                </div>
              )}

              {view === "staff" ? (
                <StaffView
                  activeMembership={activeMembership}
                  busy={busy}
                  inviteEmail={inviteEmail}
                  invitations={invitations}
                  inviteRole={inviteRole}
                  mayInvite={mayInvite}
                  members={members}
                  onInvite={handleInvite}
                  onInviteEmailChange={setInviteEmail}
                  onInviteRoleChange={setInviteRole}
                />
              ) : (
                <TournamentAdminView
                  busy={busy}
                  onAddTournamentPhase={handleAddTournamentPhase}
                  onCreateTournament={handleCreateTournament}
                  onRemoveTournamentPhase={handleRemoveTournamentPhase}
                  onTournamentNameChange={setTournamentName}
                  onTournamentPhasesChange={setTournamentPhases}
                  onTournamentPlayerCapacityChange={setTournamentPlayerCapacity}
                  onTournamentStartDateTimeChange={setTournamentStartDateTime}
                  organizationCount={organizations?.length ?? 0}
                  selectedOrganizationId={selectedOrganizationId}
                  selectedOrganizationName={details?.organization.name}
                  tournamentName={tournamentName}
                  tournamentPhases={tournamentPhases}
                  tournamentPlayerCapacity={tournamentPlayerCapacity}
                  tournamentStartDateTime={tournamentStartDateTime}
                  tournaments={tournaments}
                />
              )}
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function AdminNavLink({
  active,
  children,
  href,
}: {
  active: boolean;
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
        active
          ? "bg-white text-stone-950"
          : "text-stone-200 hover:bg-white/10"
      }`}
    >
      {children}
    </Link>
  );
}

function TournamentAdminView({
  busy,
  onAddTournamentPhase,
  onCreateTournament,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  organizationCount,
  selectedOrganizationId,
  selectedOrganizationName,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
  tournaments,
}: {
  busy: BusyState;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  organizationCount: number;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
  tournaments: Tournament[] | undefined;
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Organizations" value={organizationCount} icon={Building2} />
        <Metric
          label="Upcoming events"
          value={tournaments?.length ?? 0}
          icon={CalendarDays}
        />
        <Metric
          label="Current org"
          value={selectedOrganizationName ? 1 : 0}
          icon={ShieldCheck}
        />
      </div>

      <CreateTournamentForm
        busy={busy}
        onAddTournamentPhase={onAddTournamentPhase}
        onCreateTournament={onCreateTournament}
        onRemoveTournamentPhase={onRemoveTournamentPhase}
        onTournamentNameChange={onTournamentNameChange}
        onTournamentPhasesChange={onTournamentPhasesChange}
        onTournamentPlayerCapacityChange={onTournamentPlayerCapacityChange}
        onTournamentStartDateTimeChange={onTournamentStartDateTimeChange}
        selectedOrganizationId={selectedOrganizationId}
        tournamentName={tournamentName}
        tournamentPhases={tournamentPhases}
        tournamentPlayerCapacity={tournamentPlayerCapacity}
        tournamentStartDateTime={tournamentStartDateTime}
      />

      <section className="grid gap-4">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-emerald-700" />
          <h2 className="text-lg font-semibold">Tournaments</h2>
        </div>
        <TournamentTable tournaments={tournaments} />
      </section>
    </div>
  );
}

function CreateTournamentForm({
  busy,
  onAddTournamentPhase,
  onCreateTournament,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  selectedOrganizationId,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
}: {
  busy: BusyState;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  selectedOrganizationId: Id<"organizations"> | null;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
}) {
  const disabled = !selectedOrganizationId || busy === "tournament";

  return (
    <form
      onSubmit={onCreateTournament}
      className="rounded-md border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-emerald-700" />
          <h2 className="text-sm font-semibold">Create tournament</h2>
        </div>
        <Button
          type="submit"
          disabled={disabled}
          className="h-9 bg-emerald-700 text-white hover:bg-emerald-800"
        >
          Create
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr_140px]">
        <input
          value={tournamentName}
          onChange={(event) => onTournamentNameChange(event.target.value)}
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          placeholder="Store Championship"
          disabled={disabled}
          required
        />
        <input
          value={tournamentStartDateTime}
          onChange={(event) =>
            onTournamentStartDateTimeChange(event.target.value)
          }
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          type="datetime-local"
          disabled={disabled}
          required
        />
        <input
          value={tournamentPlayerCapacity}
          onChange={(event) =>
            onTournamentPlayerCapacityChange(event.target.value)
          }
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          type="number"
          min={2}
          max={512}
          disabled={disabled}
          required
        />
      </div>

      <div className="mt-4 grid gap-2">
        {tournamentPhases.map((phase, index) => (
          <div
            key={phase.id}
            className="grid gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 md:grid-cols-[90px_80px_1fr_120px_40px]"
          >
            <span className="flex h-10 items-center text-sm font-medium">
              Phase {index + 1}
            </span>
            <span className="flex h-10 items-center text-xs font-medium uppercase tracking-[0.12em] text-stone-500">
              Swiss
            </span>
            <select
              value={phase.phaseRoundMode}
              onChange={(event) =>
                onTournamentPhasesChange(
                  tournamentPhases.map((current) =>
                    current.id === phase.id
                      ? {
                          ...current,
                          phaseRoundMode: event.target
                            .value as TournamentCreationPhaseRoundMode,
                        }
                      : current,
                  ),
                )
              }
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
              disabled={disabled}
            >
              <option value="dynamic">Dynamic rounds</option>
              <option value="fixed">Fixed rounds</option>
            </select>
            <input
              value={phase.phaseTotalRounds}
              onChange={(event) =>
                onTournamentPhasesChange(
                  tournamentPhases.map((current) =>
                    current.id === phase.id
                      ? { ...current, phaseTotalRounds: event.target.value }
                      : current,
                  ),
                )
              }
              className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-stone-100 disabled:text-stone-400"
              type="number"
              min={1}
              max={16}
              disabled={disabled || phase.phaseRoundMode === "dynamic"}
              required={phase.phaseRoundMode === "fixed"}
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 px-0"
              onClick={() => onRemoveTournamentPhase(phase.id)}
              disabled={disabled || tournamentPhases.length === 1}
              aria-label={`Remove phase ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onAddTournamentPhase}
        disabled={disabled}
        className="mt-3 h-9"
      >
        <Plus className="size-4" />
        Add Swiss phase
      </Button>
      {!selectedOrganizationId && (
        <p className="mt-3 text-xs leading-5 text-stone-500">
          Create or select an organization before creating tournaments.
        </p>
      )}
    </form>
  );
}

function StaffView({
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
  invitations:
    | Array<{
        _id: Id<"organizationInvitations">;
        email: string;
        role: MemberRole;
        status: InvitationStatus;
      }>
    | undefined;
  inviteRole: Role;
  mayInvite: boolean;
  members:
    | Array<{
        _id: Id<"organizationMemberships">;
        email?: string;
        workosUserId?: string;
        role: MemberRole;
        status: string;
      }>
    | undefined;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onInviteEmailChange: (email: string) => void;
  onInviteRoleChange: (role: Role) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
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
              <span className="text-xs capitalize text-stone-500">
                {member.role}
              </span>
              <span className="text-xs capitalize text-stone-500">
                {member.status}
              </span>
            </div>
          ))}
          {members?.length === 0 && (
            <p className="px-4 py-6 text-sm text-stone-500">
              No members mirrored yet.
            </p>
          )}
          {members === undefined && (
            <p className="px-4 py-6 text-sm text-stone-500">Loading members...</p>
          )}
        </div>
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
        </section>

        <form
          onSubmit={onInvite}
          className="rounded-md border border-stone-200 bg-white p-4"
        >
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-emerald-700" />
            <h2 className="text-sm font-semibold">Invite staff</h2>
          </div>
          <div className="mt-4 grid gap-3">
            <input
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
              placeholder="judge@example.com"
              type="email"
              disabled={!mayInvite}
              required
            />
            <select
              value={inviteRole}
              onChange={(event) => onInviteRoleChange(event.target.value as Role)}
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
              <div
                key={invitation._id}
                className="border-t border-stone-100 pt-3"
              >
                <p className="truncate text-sm font-medium">
                  {invitation.email}
                </p>
                <p className="mt-1 text-xs capitalize text-stone-500">
                  {invitation.role} · {invitation.status}
                </p>
              </div>
            ))}
            {invitations?.length === 0 && (
              <p className="text-sm text-stone-500">No invitations sent.</p>
            )}
            {invitations === undefined && (
              <p className="text-sm text-stone-500">Loading invitations...</p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function TournamentTable({
  tournaments,
}: {
  tournaments: Tournament[] | undefined;
}) {
  if (tournaments === undefined) {
    return (
      <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
        <div className="grid gap-3 p-4">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-12 animate-pulse rounded-md bg-stone-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <section className="grid min-h-64 place-items-center rounded-md border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
        <div className="max-w-md">
          <CalendarDays className="mx-auto size-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-semibold">No upcoming tournaments</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Future tournaments for this organization will appear here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Tournament</th>
              <th className="px-4 py-3 font-medium">Format</th>
              <th className="px-4 py-3 font-medium">Start date</th>
              <th className="px-4 py-3 font-medium">Capacity</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return (
    <tr className="border-t border-stone-100">
      <td className="px-4 py-4">
        <p className="font-medium text-stone-950">{tournament.name}</p>
        <p className="mt-1 text-xs text-stone-500">
          {tournament.isTestEvent ? "Test event" : "Organization event"}
        </p>
      </td>
      <td className="px-4 py-4 capitalize text-stone-700">
        {tournament.format}
      </td>
      <td className="px-4 py-4 text-stone-700">
        {dateFormatter.format(new Date(tournament.startDate))}
      </td>
      <td className="px-4 py-4 text-stone-700">{tournament.playerCapacity}</td>
      <td className="px-4 py-4">
        <span className="inline-flex rounded-md bg-stone-100 px-2 py-1 text-xs font-medium capitalize text-stone-700">
          {tournament.status}
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <Button type="button" variant="outline" disabled>
          Manage soon
        </Button>
      </td>
    </tr>
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
