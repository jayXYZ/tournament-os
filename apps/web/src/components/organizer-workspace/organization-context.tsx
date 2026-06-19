import {
  
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type {ReactNode} from 'react';
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { OrganizationRow } from './types'

const SELECTED_ORGANIZATION_STORAGE_KEY = 'tournament-os:selected-organization'

function getStoredOrganizationId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(
    SELECTED_ORGANIZATION_STORAGE_KEY,
  ) as Id<'organizations'> | null
}

type OrganizationContextValue = {
  organizations: Array<OrganizationRow> | undefined
  selectedOrganizationId: Id<'organizations'> | null
  selectedOrganization: OrganizationRow | null
  selectOrganization: (id: Id<'organizations'>) => void
  clearSelectedOrganization: () => void
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null)

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const organizations = useQuery(api.organizations.listMine)
  const [explicitOrganizationId, setExplicitOrganizationId] =
    useState<Id<'organizations'> | null>(getStoredOrganizationId)

  const selectOrganization = useCallback((id: Id<'organizations'>) => {
    setExplicitOrganizationId(id)
    window.localStorage.setItem(SELECTED_ORGANIZATION_STORAGE_KEY, id)
  }, [])

  const clearSelectedOrganization = useCallback(() => {
    window.localStorage.removeItem(SELECTED_ORGANIZATION_STORAGE_KEY)
    setExplicitOrganizationId(null)
  }, [])

  const selectedOrganizationId = useMemo(() => {
    if (!explicitOrganizationId) {
      return organizations?.[0]?.organization._id ?? null
    }
    if (
      organizations &&
      !organizations.some(
        (row) => row.organization._id === explicitOrganizationId,
      )
    ) {
      return organizations[0]?.organization._id ?? null
    }
    return explicitOrganizationId
  }, [explicitOrganizationId, organizations])

  const selectedOrganization = useMemo(
    () =>
      organizations?.find(
        (row) => row.organization._id === selectedOrganizationId,
      ) ?? null,
    [organizations, selectedOrganizationId],
  )

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organizations,
      selectedOrganizationId,
      selectedOrganization,
      selectOrganization,
      clearSelectedOrganization,
    }),
    [
      organizations,
      selectedOrganizationId,
      selectedOrganization,
      selectOrganization,
      clearSelectedOrganization,
    ],
  )

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error(
      'useOrganization must be used within an OrganizationProvider',
    )
  }
  return context
}
