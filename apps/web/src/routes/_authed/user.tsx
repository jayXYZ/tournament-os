import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { api } from '@tournament-os/backend/convex/_generated/api'

export const Route = createFileRoute('/_authed/user')({
  component: RouteComponent,
})

function RouteComponent() {
  const { isAuthenticated } = useConvexAuth()
  const upsertMe = useMutation(api.users.upsertMe)
  const me = useQuery(api.users.me, isAuthenticated ? {} : 'skip')

  // Creates (or refreshes) the Convex user row for the signed-in Clerk user,
  // which also activates any pending organization invitations for their email.
  useEffect(() => {
    if (isAuthenticated) {
      void upsertMe()
    }
  }, [isAuthenticated, upsertMe])

  if (!isAuthenticated || me === undefined) {
    return <p className="p-2">Connecting…</p>
  }

  return (
    <div className="p-2 flex gap-2 flex-col">
      {me === null ? (
        <p>Setting up your profile…</p>
      ) : (
        <p>
          Welcome{me.name ? `, ${me.name}` : ''}! Your email address is{' '}
          {me.email ?? 'unknown'}.
        </p>
      )}
    </div>
  )
}
