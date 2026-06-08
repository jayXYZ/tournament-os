"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { canInviteMembers } from "@/lib/organizer-utils";
import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
  type TournamentCreationPhaseForm,
} from "@/lib/tournament-creation-utils";
import { AdminHeader, AdminSidebar } from "./organizer-workspace/admin-sidebar";
import { StaffView } from "./organizer-workspace/staff-view";
import { TournamentAdminView } from "./organizer-workspace/tournament-admin-view";
import type { AdminView, BusyState, Role } from "./organizer-workspace/types";

const SELECTED_ORGANIZATION_STORAGE_KEY =
  "tournament-os:selected-organization";

function getStoredOrganizationId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(
    SELECTED_ORGANIZATION_STORAGE_KEY,
  ) as Id<"organizations"> | null;
}

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
    useState<Id<"organizations"> | null>(getStoredOrganizationId);
  const [organizationName, setOrganizationName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentStartDateTime, setTournamentStartDateTime] = useState("");
  const [tournamentPlayerCapacity, setTournamentPlayerCapacity] = useState("32");
  const [tournamentPhases, setTournamentPhases] = useState<
    TournamentCreationPhaseForm[]
  >([createDefaultTournamentCreationPhase("phase-1")]);
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  const selectOrganization = useCallback((id: Id<"organizations">) => {
    setExplicitOrganizationId(id);
    window.localStorage.setItem(SELECTED_ORGANIZATION_STORAGE_KEY, id);
  }, []);

  const selectedOrganizationId = useMemo(() => {
    if (!explicitOrganizationId) {
      return organizations?.[0]?.organization._id ?? null;
    }
    if (
      organizations &&
      !organizations.some(
        (row) => row.organization._id === explicitOrganizationId,
      )
    ) {
      return organizations[0]?.organization._id ?? null;
    }
    return explicitOrganizationId;
  }, [explicitOrganizationId, organizations]);

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
      selectOrganization(result.organizationId);
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
      setCreateTournamentOpen(false);
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
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
          busy={busy}
          organizationName={organizationName}
          organizations={organizations}
          selectedOrganizationId={selectedOrganizationId}
          selectedOrganizationName={details?.organization.name}
          onCreateOrganization={handleCreateOrganization}
          onOrganizationNameChange={setOrganizationName}
          onSelectOrganization={selectOrganization}
          view={view}
        />
        <SidebarInset>
          <AdminHeader
            email={user?.email ?? undefined}
            name={user?.firstName ?? undefined}
            onSignOut={() => void signOut()}
          />

          <div className="p-4 sm:p-6 lg:p-8">
            <div className="mx-auto grid max-w-6xl gap-6">
              {notice && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                  <CheckCircle2 className="size-4 text-muted-foreground" />
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
                  createTournamentOpen={createTournamentOpen}
                  onAddTournamentPhase={handleAddTournamentPhase}
                  onCreateTournament={handleCreateTournament}
                  onCreateTournamentOpenChange={setCreateTournamentOpen}
                  onRemoveTournamentPhase={handleRemoveTournamentPhase}
                  onTournamentNameChange={setTournamentName}
                  onTournamentPhasesChange={setTournamentPhases}
                  onTournamentPlayerCapacityChange={setTournamentPlayerCapacity}
                  onTournamentStartDateTimeChange={setTournamentStartDateTime}
                  selectedOrganizationId={selectedOrganizationId}
                  selectedOrganizationName={details?.organization.name}
                  tournamentName={tournamentName}
                  tournamentPhases={tournamentPhases}
                  tournamentPlayerCapacity={tournamentPlayerCapacity}
                  tournamentStartDateTime={tournamentStartDateTime}
                  tournaments={tournaments}
                />
              )}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
