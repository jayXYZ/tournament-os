"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  LogOut,
  Plus,
  Trash2,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  canInviteMembers,
  type InvitationStatus,
  type OrganizerInviteRole,
  type OrganizerRole,
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
type OrganizationRow = {
  organization: Doc<"organizations">;
  membership: Doc<"organizationMemberships">;
};

const SELECTED_ORGANIZATION_STORAGE_KEY =
  "tournament-os:selected-organization";

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
  const [createTournamentOpen, setCreateTournamentOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  useEffect(() => {
    const stored = window.localStorage.getItem(
      SELECTED_ORGANIZATION_STORAGE_KEY,
    );
    if (stored) {
      setExplicitOrganizationId(stored as Id<"organizations">);
    }
  }, []);

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
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
            </div>
            <UserMenu
              email={user?.email ?? undefined}
              name={user?.firstName ?? undefined}
              onSignOut={() => void signOut()}
            />
          </header>

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

function AdminSidebar({
  busy,
  organizationName,
  organizations,
  selectedOrganizationId,
  selectedOrganizationName,
  onCreateOrganization,
  onOrganizationNameChange,
  onSelectOrganization,
  view,
}: {
  busy: BusyState;
  organizationName: string;
  organizations: OrganizationRow[] | undefined;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  onCreateOrganization: (event: FormEvent<HTMLFormElement>) => void;
  onOrganizationNameChange: (value: string) => void;
  onSelectOrganization: (id: Id<"organizations">) => void;
  view: AdminView;
}) {
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrganizationSwitcher
              organizations={organizations}
              selectedOrganizationId={selectedOrganizationId}
              selectedOrganizationName={selectedOrganizationName}
              onSelectOrganization={onSelectOrganization}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === "tournaments"}
                  tooltip="Tournaments"
                >
                  <Link href="/admin">
                    <Trophy />
                    <span>Tournaments</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === "staff"}
                  tooltip="Staff"
                >
                  <Link href="/admin/staff">
                    <Users />
                    <span>Staff</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>New organization</SidebarGroupLabel>
          <SidebarGroupContent>
            <form
              onSubmit={onCreateOrganization}
              className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="organization-name" className="sr-only">
                    Organization name
                  </FieldLabel>
                  <Input
                    id="organization-name"
                    value={organizationName}
                    onChange={(event) =>
                      onOrganizationNameChange(event.target.value)
                    }
                    placeholder="Main Street Games"
                    required
                  />
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={busy === "org"}>
                {busy === "org" ? <Spinner data-icon="inline-start" /> : null}
                Create
              </Button>
            </form>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Player view">
              <Link href="/">
                <ArrowLeft />
                <span>Player view</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function OrganizationSwitcher({
  organizations,
  selectedOrganizationId,
  selectedOrganizationName,
  onSelectOrganization,
}: {
  organizations: OrganizationRow[] | undefined;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  onSelectOrganization: (id: Id<"organizations">) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg">
          <Building2 />
          <span>{selectedOrganizationName ?? "Select organization"}</span>
          <ChevronDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-[calc(var(--radix-dropdown-menu-trigger-width)+2rem)] border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground"
      >
        <DropdownMenuLabel>Organizer workspaces</DropdownMenuLabel>
        <DropdownMenuGroup>
          {!organizations && (
            <DropdownMenuItem disabled>
              <SidebarMenuSkeleton showIcon />
              <span>Loading</span>
            </DropdownMenuItem>
          )}
          {organizations?.length === 0 && (
            <DropdownMenuItem disabled>No organizer workspaces</DropdownMenuItem>
          )}
          {organizations?.map(({ organization, membership }) => (
            <DropdownMenuItem
              key={organization._id}
              onSelect={() => onSelectOrganization(organization._id)}
            >
              <Building2 />
              <span className="truncate">{organization.name}</span>
              <span className="ml-auto text-muted-foreground capitalize">
                {membership.role}
              </span>
              {selectedOrganizationId === organization._id && <Check />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({
  email,
  name,
  onSignOut,
}: {
  email?: string;
  name?: string;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon">
          <UserRound />
          <span className="sr-only">Open user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-foreground">{name ?? "Player account"}</span>
          {email && <span className="block truncate">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TournamentAdminView({
  busy,
  createTournamentOpen,
  onAddTournamentPhase,
  onCreateTournament,
  onCreateTournamentOpenChange,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  selectedOrganizationId,
  selectedOrganizationName,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
  tournaments,
}: {
  busy: BusyState;
  createTournamentOpen: boolean;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onCreateTournamentOpenChange: (open: boolean) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
  tournaments: Tournament[] | undefined;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {selectedOrganizationName ?? "Admin workspace"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Tournaments
          </h1>
        </div>
        <CreateTournamentDialog
          busy={busy}
          onAddTournamentPhase={onAddTournamentPhase}
          onCreateTournament={onCreateTournament}
          onOpenChange={onCreateTournamentOpenChange}
          onRemoveTournamentPhase={onRemoveTournamentPhase}
          onTournamentNameChange={onTournamentNameChange}
          onTournamentPhasesChange={onTournamentPhasesChange}
          onTournamentPlayerCapacityChange={onTournamentPlayerCapacityChange}
          onTournamentStartDateTimeChange={onTournamentStartDateTimeChange}
          open={createTournamentOpen}
          selectedOrganizationId={selectedOrganizationId}
          tournamentName={tournamentName}
          tournamentPhases={tournamentPhases}
          tournamentPlayerCapacity={tournamentPlayerCapacity}
          tournamentStartDateTime={tournamentStartDateTime}
        />
      </div>

      <TournamentTable tournaments={tournaments} />
    </section>
  );
}

function CreateTournamentDialog({
  busy,
  onAddTournamentPhase,
  onCreateTournament,
  onOpenChange,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  open,
  selectedOrganizationId,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
}: {
  busy: BusyState;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChange: (open: boolean) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  open: boolean;
  selectedOrganizationId: Id<"organizations"> | null;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
}) {
  const disabled = !selectedOrganizationId || busy === "tournament";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!selectedOrganizationId}>
          <Plus data-icon="inline-start" />
          Create new tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onCreateTournament} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create tournament</DialogTitle>
            <DialogDescription>
              Add the tournament details and Swiss phases.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_120px]">
              <Field>
                <FieldLabel htmlFor="tournament-name">Name</FieldLabel>
                <Input
                  id="tournament-name"
                  value={tournamentName}
                  onChange={(event) =>
                    onTournamentNameChange(event.target.value)
                  }
                  placeholder="Store Championship"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-start">Start date</FieldLabel>
                <Input
                  id="tournament-start"
                  value={tournamentStartDateTime}
                  onChange={(event) =>
                    onTournamentStartDateTimeChange(event.target.value)
                  }
                  type="datetime-local"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-capacity">Capacity</FieldLabel>
                <Input
                  id="tournament-capacity"
                  value={tournamentPlayerCapacity}
                  onChange={(event) =>
                    onTournamentPlayerCapacityChange(event.target.value)
                  }
                  type="number"
                  min={2}
                  max={512}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>

            <FieldSet>
              <FieldLegend>Swiss phases</FieldLegend>
              <FieldGroup>
                {tournamentPhases.map((phase, index) => (
                  <TournamentPhaseField
                    key={phase.id}
                    disabled={disabled}
                    index={index}
                    onRemoveTournamentPhase={onRemoveTournamentPhase}
                    onTournamentPhasesChange={onTournamentPhasesChange}
                    phase={phase}
                    tournamentPhases={tournamentPhases}
                  />
                ))}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                onClick={onAddTournamentPhase}
                disabled={disabled}
              >
                <Plus data-icon="inline-start" />
                Add Swiss phase
              </Button>
            </FieldSet>

            {!selectedOrganizationId && (
              <FieldDescription>
                Create or select an organization before creating tournaments.
              </FieldDescription>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={disabled}>
              {busy === "tournament" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TournamentPhaseField({
  disabled,
  index,
  onRemoveTournamentPhase,
  onTournamentPhasesChange,
  phase,
  tournamentPhases,
}: {
  disabled: boolean;
  index: number;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  phase: TournamentCreationPhaseForm;
  tournamentPhases: TournamentCreationPhaseForm[];
}) {
  return (
    <Field className="rounded-md border border-border p-3">
      <div className="grid gap-3 md:grid-cols-[90px_1fr_120px_32px] md:items-end">
        <div className="flex flex-col gap-1">
          <FieldLabel>Phase {index + 1}</FieldLabel>
          <FieldDescription>Swiss</FieldDescription>
        </div>
        <Field>
          <FieldLabel>Rounds</FieldLabel>
          <Select
            value={phase.phaseRoundMode}
            onValueChange={(value) =>
              onTournamentPhasesChange(
                tournamentPhases.map((current) =>
                  current.id === phase.id
                    ? {
                        ...current,
                        phaseRoundMode:
                          value as TournamentCreationPhaseRoundMode,
                      }
                    : current,
                ),
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="dynamic">Dynamic rounds</SelectItem>
                <SelectItem value="fixed">Fixed rounds</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${phase.id}-total-rounds`}>
            Total rounds
          </FieldLabel>
          <Input
            id={`${phase.id}-total-rounds`}
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
            type="number"
            min={1}
            max={16}
            disabled={disabled || phase.phaseRoundMode === "dynamic"}
            required={phase.phaseRoundMode === "fixed"}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onRemoveTournamentPhase(phase.id)}
          disabled={disabled || tournamentPhases.length === 1}
          aria-label={`Remove phase ${index + 1}`}
        >
          <Trash2 />
        </Button>
      </div>
    </Field>
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

function TournamentTable({
  tournaments,
}: {
  tournaments: Tournament[] | undefined;
}) {
  if (tournaments === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading tournaments</CardTitle>
          <CardDescription>
            Fetching events for the selected organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tournaments.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>No upcoming tournaments</EmptyTitle>
              <EmptyDescription>
                Future tournaments for this organization will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament schedule</CardTitle>
        <CardDescription>Upcoming organization tournaments.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium text-foreground">{tournament.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {tournament.isTestEvent ? "Test event" : "Organization event"}
        </p>
      </TableCell>
      <TableCell className="capitalize">{tournament.format}</TableCell>
      <TableCell>
        {dateFormatter.format(new Date(tournament.startDate))}
      </TableCell>
      <TableCell>{tournament.playerCapacity}</TableCell>
      <TableCell className="capitalize">{tournament.status}</TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="outline" disabled>
          Manage soon
        </Button>
      </TableCell>
    </TableRow>
  );
}
