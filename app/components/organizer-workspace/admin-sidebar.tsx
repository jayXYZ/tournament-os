import type { FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  LogOut,
  Plus,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { AdminView, BusyState, OrganizationRow } from "./types";

export function AdminSidebar({
  busy,
  createOrganizationOpen,
  organizationName,
  organizations,
  selectedOrganizationId,
  selectedOrganizationName,
  onCreateOrganization,
  onCreateOrganizationOpenChange,
  onOrganizationNameChange,
  onSelectOrganization,
  view,
}: {
  busy: BusyState;
  createOrganizationOpen: boolean;
  organizationName: string;
  organizations: OrganizationRow[] | undefined;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  onCreateOrganization: (event: FormEvent<HTMLFormElement>) => void;
  onCreateOrganizationOpenChange: (open: boolean) => void;
  onOrganizationNameChange: (value: string) => void;
  onSelectOrganization: (id: Id<"organizations">) => void;
  view: AdminView;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrganizationSwitcher
              busy={busy}
              createOrganizationOpen={createOrganizationOpen}
              organizationName={organizationName}
              organizations={organizations}
              selectedOrganizationId={selectedOrganizationId}
              selectedOrganizationName={selectedOrganizationName}
              onCreateOrganization={onCreateOrganization}
              onCreateOrganizationOpenChange={onCreateOrganizationOpenChange}
              onOrganizationNameChange={onOrganizationNameChange}
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

export function AdminHeader({
  email,
  name,
  onSignOut,
}: {
  email?: string;
  name?: string;
  onSignOut: () => void;
}) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
      </div>
      <UserMenu email={email} name={name} onSignOut={onSignOut} />
    </header>
  );
}

function OrganizationSwitcher({
  busy,
  createOrganizationOpen,
  organizationName,
  organizations,
  selectedOrganizationId,
  selectedOrganizationName,
  onCreateOrganization,
  onCreateOrganizationOpenChange,
  onOrganizationNameChange,
  onSelectOrganization,
}: {
  busy: BusyState;
  createOrganizationOpen: boolean;
  organizationName: string;
  organizations: OrganizationRow[] | undefined;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  onCreateOrganization: (event: FormEvent<HTMLFormElement>) => void;
  onCreateOrganizationOpenChange: (open: boolean) => void;
  onOrganizationNameChange: (value: string) => void;
  onSelectOrganization: (id: Id<"organizations">) => void;
}) {
  return (
    <Dialog
      open={createOrganizationOpen}
      onOpenChange={onCreateOrganizationOpenChange}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="group-data-[collapsible=icon]:justify-center"
          >
            <Building2 />
            <span className="group-data-[collapsible=icon]:hidden">
              {selectedOrganizationName ?? "Select organization"}
            </span>
            <ChevronDown className="ml-auto group-data-[collapsible=icon]:hidden" />
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
              <DropdownMenuItem disabled>
                No organizer workspaces
              </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => onCreateOrganizationOpenChange(true)}
            >
              <Plus />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogContent>
        <form onSubmit={onCreateOrganization} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Name the organizer workspace you want to use for tournaments and
              staff.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                value={organizationName}
                onChange={(event) =>
                  onOrganizationNameChange(event.target.value)
                }
                placeholder="Main Street Games"
                disabled={busy === "org"}
                required
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy === "org"}>
              {busy === "org" ? <Spinner data-icon="inline-start" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
