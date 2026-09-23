import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { useOrganization } from './organization-context'
import type { FormEvent } from 'react'
import { cn } from '@/lib/utils'
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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

/**
 * The organizer workspace switcher, pinned to the sidebar footer the way the
 * WorkOS dashboard pins its workspace: a letter tile, the name, and a
 * chevron. In the icon rail only the tile remains, and the menu opens beside
 * it.
 */
export function OrganizationSwitcher() {
  const {
    organizations,
    selectedOrganizationId,
    selectedOrganization,
    selectOrganization,
  } = useOrganization()
  const createOrganization = useMutation(
    api.organizations.createOrganizerOrganization,
  )

  const { isMobile, state } = useSidebar()
  const [open, setOpen] = useState(false)
  const { busy, run } = useBusyAction()
  const [organizationName, setOrganizationName] = useState('')

  async function handleCreateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const result = await createOrganization({ name: organizationName })
      selectOrganization(result.organizationId)
      setOrganizationName('')
      setOpen(false)
      toast.success('Organizer workspace created.')
    }, 'Could not create organization.')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenuTrigger asChild>
              {/* In the rail the row is a 36px tile, so the 24px avatar gets 6px
                  of padding instead of the icon rows' 10px. */}
              <SidebarMenuButton className="font-medium group-data-[collapsible=icon]:p-1.5!">
                <OrganizationAvatar
                  name={
                    selectedOrganization?.organization.name ?? 'Organization'
                  }
                  profileImageUrl={
                    selectedOrganization?.organization.profileImageUrl ?? null
                  }
                  className="size-6"
                />
                <span className="flex-1 truncate">
                  {selectedOrganization?.organization.name ??
                    'Select organization'}
                </span>
                <ChevronsUpDown className="ml-auto size-3.5" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
        <DropdownMenuContent
          align={isMobile ? 'end' : 'start'}
          side={!isMobile && state === 'collapsed' ? 'right' : 'top'}
          sideOffset={4}
          className="min-w-56"
        >
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
                  className="size-5 text-[0.625rem]"
                />
                <span className="truncate">{organization.name}</span>
                <span className="ml-auto text-gray-a11 capitalize">
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
          'size-6 shrink-0 overflow-hidden rounded-(--radius-2) bg-gray-a3 bg-cover bg-center',
          className,
        )}
        style={{ backgroundImage: `url(${profileImageUrl})` }}
      />
    )
  }

  // A workspace without a logo gets its initial on a gray-a3 tile, so every
  // workspace has a mark in the rail and in the menu.
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-(--radius-2) bg-gray-a3 text-xs font-semibold text-foreground',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
