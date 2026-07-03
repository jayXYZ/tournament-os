import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Building2, Check, ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { useOrganization } from './organization-context'
import type { FormEvent } from 'react'
import type { AdminView } from './types'
import { cn } from '@/lib/utils'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

const viewLabels: Record<AdminView, string> = {
  tournaments: 'Tournaments',
  staff: 'Staff',
  organization: 'Organization',
}

const tournamentPageLabels: Record<string, string> = {
  registrations: 'Registrations',
  pairings: 'Pairings',
  settings: 'Settings',
  standings: 'Standings',
}

function viewFromPathname(pathname: string): AdminView {
  if (pathname.startsWith('/admin/staff')) {
    return 'staff'
  }
  if (pathname.startsWith('/admin/organization')) {
    return 'organization'
  }
  return 'tournaments'
}

export function AdminBreadcrumb() {
  const pathname = useLocation().pathname
  const tournamentMatch = pathname.match(
    /^\/admin\/tournaments\/([^/]+)(?:\/([^/]+))?/,
  )

  if (tournamentMatch) {
    return (
      <TournamentBreadcrumb
        publicCode={tournamentMatch[1]}
        segment={tournamentMatch[2]}
      />
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <OrganizationSwitcher />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>
            {viewLabels[viewFromPathname(pathname)]}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function TournamentBreadcrumb({
  publicCode,
  segment,
}: {
  publicCode: string
  segment?: string
}) {
  const managed = useQuery(api.tournaments.lifecycle.getManagedTournament, {
    publicCode,
  })
  const name = managed?.tournament.name
  const pageLabel = segment ? tournamentPageLabels[segment] : undefined
  const base = `/admin/tournaments/${publicCode}`

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <OrganizationSwitcher />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Tournaments</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {managed === undefined ? (
            <Skeleton className="h-4 w-28" />
          ) : name === undefined ? (
            <BreadcrumbPage>Not found</BreadcrumbPage>
          ) : pageLabel ? (
            <BreadcrumbLink asChild>
              <Link to={base} className="max-w-48 truncate">
                {name}
              </Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="max-w-48 truncate">
              {name}
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {pageLabel && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function OrganizationSwitcher() {
  const {
    organizations,
    selectedOrganizationId,
    selectedOrganization,
    selectOrganization,
  } = useOrganization()
  const createOrganization = useMutation(
    api.organizations.createOrganizerOrganization,
  )

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [organizationName, setOrganizationName] = useState('')

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await createOrganization({ name: organizationName })
      selectOrganization(result.organizationId)
      setOrganizationName('')
      setOpen(false)
      toast.success('Organizer workspace created.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not create organization.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-sm font-medium text-foreground outline-none transition-colors hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring">
          <OrganizationAvatar
            name={selectedOrganization?.organization.name ?? 'Organization'}
            profileImageUrl={
              selectedOrganization?.organization.profileImageUrl ?? null
            }
          />
          <span className="max-w-48 truncate">
            {selectedOrganization?.organization.name ?? 'Select organization'}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-56">
          <DropdownMenuLabel>Organizer workspaces</DropdownMenuLabel>
          <DropdownMenuGroup>
            {!organizations && (
              <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
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
  )
}

function OrganizationAvatar({
  name,
  profileImageUrl,
  className,
}: {
  name: string
  profileImageUrl: string | null
  className?: string
}) {
  if (profileImageUrl) {
    return (
      <span
        role="img"
        aria-label={name}
        className={cn(
          'size-4 shrink-0 overflow-hidden rounded-sm bg-muted bg-cover bg-center',
          className,
        )}
        style={{ backgroundImage: `url(${profileImageUrl})` }}
      />
    )
  }

  return <Building2 className={cn('size-4 shrink-0', className)} />
}
