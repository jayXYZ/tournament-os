import { Link, useLocation } from '@tanstack/react-router'
import {
  ArrowLeft,
  Building2,
  LogOut,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react'
import { AdminBreadcrumb, viewFromPathname } from './admin-breadcrumb'
import { useAppAuth } from '@/lib/use-app-auth'

import { ModeToggle } from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'

export function AdminSidebar() {
  const view = viewFromPathname(useLocation().pathname)

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === 'tournaments'}
                  tooltip="Tournaments"
                >
                  <Link to="/admin">
                    <Trophy />
                    <span>Tournaments</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === 'staff'}
                  tooltip="Staff"
                >
                  <Link to="/admin/staff">
                    <Users />
                    <span>Staff</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={view === 'organization'}
                  tooltip="Organization"
                >
                  <Link to="/admin/organization">
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
              <Link to="/">
                <ArrowLeft />
                <span>Player view</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export function AdminHeader() {
  const { user, signOut } = useAppAuth()

  return (
    <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 md:rounded-t-xl sm:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator
          orientation="vertical"
          className="h-4 data-vertical:self-center"
        />
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
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-foreground">
            {name ?? 'Player account'}
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
  )
}
