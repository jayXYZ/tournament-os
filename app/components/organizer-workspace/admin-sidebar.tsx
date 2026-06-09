"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAction } from "convex/react";
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

import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useOrganization } from "./organization-context";
import { useSetNotice } from "./notice-context";
import type { AdminView } from "./types";

export function AdminSidebar({ view }: { view: AdminView }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrganizationSwitcher />
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === "organization"}
                  tooltip="Organization"
                >
                  <Link href="/admin/organization">
                    <Building2 />
                    <span>Organization</span>
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

export function AdminHeader() {
  const { user, signOut } = useAuth();

  return (
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
  );
}

function OrganizationSwitcher() {
  const {
    organizations,
    selectedOrganizationId,
    selectedOrganization,
    selectOrganization,
  } = useOrganization();
  const setNotice = useSetNotice();
  const { state, isMobile } = useSidebar();
  const createOrganization = useAction(
    api.organizations.createOrganizerOrganization,
  );

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [organizationName, setOrganizationName] = useState("");

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await createOrganization({ name: organizationName });
      selectOrganization(result.organizationId);
      setOrganizationName("");
      setOpen(false);
      setNotice("Organizer workspace created.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not create organization.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="group-data-[collapsible=icon]:justify-center"
          >
            <OrganizationAvatar
              name={selectedOrganization?.organization.name ?? "Organization"}
              profileImageUrl={
                selectedOrganization?.organization.profileImageUrl ?? null
              }
              className="size-8 rounded-md"
            />
            <span className="group-data-[collapsible=icon]:hidden">
              {selectedOrganization?.organization.name ?? "Select organization"}
            </span>
            <ChevronDown className="ml-auto group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={!isMobile && state === "collapsed" ? "right" : "bottom"}
          sideOffset={4}
          className="min-w-56 border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground"
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
                onSelect={() => selectOrganization(organization._id)}
              >
                <OrganizationAvatar
                  name={organization.name}
                  profileImageUrl={organization.profileImageUrl}
                />
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
            <DropdownMenuItem onSelect={() => setOpen(true)}>
              <Plus />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogContent>
        <form
          onSubmit={handleCreateOrganization}
          className="flex flex-col gap-4"
        >
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
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Main Street Games"
                disabled={busy}
                required
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrganizationAvatar({
  name,
  profileImageUrl,
  className,
}: {
  name: string;
  profileImageUrl: string | null;
  className?: string;
}) {
  if (profileImageUrl) {
    return (
      <span
        role="img"
        aria-label={name}
        className={cn(
          "size-4 shrink-0 overflow-hidden rounded-sm bg-muted bg-cover bg-center",
          className,
        )}
        style={{ backgroundImage: `url(${profileImageUrl})` }}
      />
    );
  }

  return <Building2 className={className} />;
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
          <span className="block text-foreground">
            {name ?? "Player account"}
          </span>
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
