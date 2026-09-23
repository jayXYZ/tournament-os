import { Link, useLocation } from '@tanstack/react-router'
import {
  Building2,
  DoorOpen,
  LogOut,
  Tent,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react'
import { AdminBreadcrumb, viewFromPathname } from './admin-breadcrumb'
import { OrganizationSwitcher } from './organization-switcher'
import { useAppAuth } from '@/lib/use-app-auth'

import { ModeToggle } from '@/components/mode-toggle'
import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'

const views = [
  { view: 'tournaments', label: 'Tournaments', to: '/admin', icon: Trophy },
  {
    view: 'conventions',
    label: 'Conventions',
    to: '/admin/conventions',
    icon: Tent,
  },
  { view: 'staff', label: 'Staff', to: '/admin/staff', icon: Users },
  {
    view: 'organization',
    label: 'Organization',
    to: '/admin/organization',
    icon: Building2,
  },
] as const

/**
 * The workspace chrome follows the WorkOS dashboard: the sidebar header
 * carries the brand and the collapse toggle at the app header's height, the
 * nav is one unlabeled group, and the workspace switcher is pinned to the
 * footer. Collapsed, the header keeps only the toggle and the footer only
 * the workspace tile.
 */
export function AdminSidebar() {
  const view = viewFromPathname(useLocation().pathname)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group-data-[collapsible=icon]:gap-0">
        {/*
          The brand stays in flow while collapsed (zero width, invisible)
          instead of `hidden`, so it never re-mounts at icon width and wraps
          the wordmark onto two lines mid-transition. `whitespace-nowrap`
          and the clipped overflow let it slide out from under the growing
          edge; the fade lags the width so it appears as the room opens up.
        */}
        <Link
          to="/admin"
          className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-(--radius-2) outline-none transition-[opacity,visibility] duration-200 ease-out delay-75 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring group-data-[collapsible=icon]:invisible group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-0 group-data-[collapsible=icon]:duration-100"
        >
          <BrandMark className="size-6 shrink-0" />
          <span className="text-sm font-semibold">Paper Pairings</span>
        </Link>
        <SidebarTrigger className="ml-auto shrink-0 group-data-[collapsible=icon]:ml-0" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {views.map((item) => (
                <SidebarMenuItem key={item.view}>
                  <SidebarMenuButton
                    asChild
                    isActive={view === item.view}
                    tooltip={item.label}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <OrganizationSwitcher />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export function AdminHeader() {
  const { user, signOut } = useAppAuth()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Below md the sidebar is a sheet with no header of its own, so the
            toggle lives here. */}
        <SidebarTrigger className="-ml-2 md:hidden" />
        <AdminBreadcrumb />
      </div>
      <div className="flex items-center gap-2">
        <ModeToggle />
        <UserMenu
          email={user?.email ?? undefined}
          name={user?.firstName ?? undefined}
          onSignOut={() => void signOut()}
        />
      </div>
    </header>
  )
}

function UserMenu({
  email,
  name,
  onSignOut,
}: {
  email?: string
  name?: string
  onSignOut: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon">
          <UserRound />
          <span className="sr-only">Open user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>
          <span className="block text-foreground">
            {name ?? 'Player account'}
          </span>
          {email && <span className="block truncate">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/">
            <DoorOpen />
            Leave admin
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
