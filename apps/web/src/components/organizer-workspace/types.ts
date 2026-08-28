import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

export type AdminView = 'tournaments' | 'staff' | 'organization'

export type OrganizationRow = {
  organization: Doc<'organizations'> & { profileImageUrl: string | null }
  membership: Doc<'organizationMemberships'>
}
