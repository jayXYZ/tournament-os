import { useUser } from '@clerk/tanstack-react-start'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/user')({
  component: RouteComponent,
})

function RouteComponent() {
  const { user } = useUser()

  return (
    <div className="p-2 flex gap-2 flex-col">
      {user === null || user === undefined ? (
        <p>You are not logged in.</p>
      ) : (
        <p>
          Welcome! Your email address is{' '}
          {user.primaryEmailAddress?.emailAddress}.
        </p>
      )}
    </div>
  )
}
