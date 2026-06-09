"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  validateOrganizationProfileImageDetails,
  type OrganizationProfileImageDetails,
} from "@/lib/organization-profile-image";
import {
  canInviteMembers,
  canManageOrganizationProfile,
} from "@/lib/organizer-utils";
import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
  type TournamentCreationPhaseForm,
} from "@/lib/tournament-creation-utils";
import { AdminHeader, AdminSidebar } from "./organizer-workspace/admin-sidebar";
import { OrganizationProfileView } from "./organizer-workspace/organization-profile-view";
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
  const generateProfileImageUploadUrl = useMutation(
    api.organizations.generateProfileImageUploadUrl,
  );
  const updateProfileImage = useMutation(api.organizations.updateProfileImage);
  const updateProfile = useAction(api.organizations.updateProfile);
  const archiveOrganization = useMutation(api.organizations.archiveOrganization);

  const [explicitOrganizationId, setExplicitOrganizationId] =
    useState<Id<"organizations"> | null>(getStoredOrganizationId);
  const [organizationName, setOrganizationName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentStartDateTime, setTournamentStartDateTime] = useState("");
  const [tournamentPlayerCapacity, setTournamentPlayerCapacity] = useState("32");
  const [tournamentIsTestEvent, setTournamentIsTestEvent] = useState(false);
  const [tournamentPhases, setTournamentPhases] = useState<
    TournamentCreationPhaseForm[]
  >([createDefaultTournamentCreationPhase("phase-1")]);
  const [profileName, setProfileName] = useState("");
  const [archiveConfirmationName, setArchiveConfirmationName] = useState("");
  const [createOrganizationOpen, setCreateOrganizationOpen] = useState(false);
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
  const mayManageProfile = activeMembership
    ? canManageOrganizationProfile(activeMembership.role)
    : false;

  useEffect(() => {
    if (details?.organization.name) {
      setProfileName(details.organization.name);
      setArchiveConfirmationName("");
    }
  }, [details?.organization._id, details?.organization.name]);

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("org");
    setNotice(null);

    try {
      const result = await createOrganization({ name: organizationName });
      selectOrganization(result.organizationId);
      setOrganizationName("");
      setCreateOrganizationOpen(false);
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
        isTestEvent: tournamentIsTestEvent,
        phases: toTournamentCreationPhasePayload(tournamentPhases),
      });
      setTournamentName("");
      setTournamentStartDateTime("");
      setTournamentPlayerCapacity("32");
      setTournamentIsTestEvent(false);
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

  async function handleUpdateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy("profile");
    setNotice(null);
    try {
      await updateProfile({
        organizationId: selectedOrganizationId,
        name: profileName,
      });
      setNotice("Organization profile updated.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not update organization profile.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateProfileImage(file: File) {
    if (!selectedOrganizationId) {
      return;
    }

    setBusy("profileImage");
    setNotice(null);
    try {
      const dimensions = await readImageDimensions(file);
      const validationMessage = validateOrganizationProfileImageDetails({
        type: file.type,
        size: file.size,
        ...dimensions,
      });
      if (validationMessage) {
        throw new Error(validationMessage);
      }

      const uploadUrl = await generateProfileImageUploadUrl({
        organizationId: selectedOrganizationId,
      });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Could not upload profile picture.");
      }

      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await updateProfileImage({
        organizationId: selectedOrganizationId,
        profileImageStorageId: storageId,
      });
      setNotice("Organization profile picture updated.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not update organization profile picture.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleArchiveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy("archive");
    setNotice(null);
    try {
      await archiveOrganization({
        organizationId: selectedOrganizationId,
        confirmationName: archiveConfirmationName,
      });
      window.localStorage.removeItem(SELECTED_ORGANIZATION_STORAGE_KEY);
      setExplicitOrganizationId(null);
      setArchiveConfirmationName("");
      setNotice("Organization archived.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not archive organization.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
          busy={busy}
          createOrganizationOpen={createOrganizationOpen}
          organizationName={organizationName}
          organizations={organizations}
          selectedOrganizationId={selectedOrganizationId}
          selectedOrganizationName={details?.organization.name}
          onCreateOrganization={handleCreateOrganization}
          onCreateOrganizationOpenChange={setCreateOrganizationOpen}
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
              ) : view === "organization" ? (
                <OrganizationProfileView
                  archiveConfirmationName={archiveConfirmationName}
                  busy={busy}
                  mayManageProfile={mayManageProfile}
                  membershipRole={activeMembership?.role ?? null}
                  onArchiveConfirmationNameChange={setArchiveConfirmationName}
                  onArchiveOrganization={handleArchiveOrganization}
                  onProfileImageChange={(file) =>
                    void handleUpdateProfileImage(file)
                  }
                  onProfileNameChange={setProfileName}
                  onUpdateProfile={handleUpdateProfile}
                  organization={details?.organization ?? null}
                  profileName={profileName}
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
                  onTournamentIsTestEventChange={setTournamentIsTestEvent}
                  onTournamentPhasesChange={setTournamentPhases}
                  onTournamentPlayerCapacityChange={setTournamentPlayerCapacity}
                  onTournamentStartDateTimeChange={setTournamentStartDateTime}
                  selectedOrganizationId={selectedOrganizationId}
                  selectedOrganizationName={details?.organization.name}
                  tournamentName={tournamentName}
                  tournamentIsTestEvent={tournamentIsTestEvent}
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

function readImageDimensions(file: File) {
  return new Promise<Pick<OrganizationProfileImageDetails, "width" | "height">>(
    (resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read profile picture dimensions."));
      };
      image.src = objectUrl;
    },
  );
}
