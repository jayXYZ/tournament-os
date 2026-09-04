import { createFileRoute } from '@tanstack/react-router'
import { ConventionPublicPage } from '@/components/convention-public-page'

export const Route = createFileRoute('/conventions/$conventionId/')({
  component: RouteComponent,
})

function RouteComponent() {
  // The URL param is the public convention code, not the Convex id.
  const { conventionId: publicCode } = Route.useParams()
  return <ConventionPublicPage publicCode={publicCode} />
}
