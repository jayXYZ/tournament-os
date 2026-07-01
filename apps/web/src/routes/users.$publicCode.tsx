import { createFileRoute } from '@tanstack/react-router'
import { UserPublicPage } from '@/components/user-public-page'

export const Route = createFileRoute('/users/$publicCode')({
  component: RouteComponent,
})

function RouteComponent() {
  const { publicCode } = Route.useParams()
  return <UserPublicPage publicCode={publicCode} />
}
