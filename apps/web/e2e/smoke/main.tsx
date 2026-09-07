import { createRoot } from 'react-dom/client'
import {
  RouterProvider,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { calls, finishSignIn, scenario, useFixture } from './adapters'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { TournamentPublicPageContent } from '@/components/tournament-public-page'
import { ConventionPublicPage } from '@/components/convention-public-page'
import { TournamentProgressBar } from '@/components/organizer-workspace/tournament-manager/tournament-progress-bar'
import '@/styles/app.css'

function SmokePage() {
  useFixture()
  return (
    <>
      <button onClick={finishSignIn}>Finish sign-in</button>
      {scenario === 'organizer' ? (
        <TournamentProgressBar
          tournamentId={'tournament' as Id<'tournaments'>}
          publicCode="100001"
        />
      ) : scenario === 'badge' ? (
        <ConventionPublicPage publicCode="100001" />
      ) : (
        <TournamentPublicPageContent publicCode="100001" />
      )}
      <output data-testid="mutation-calls">{JSON.stringify(calls)}</output>
    </>
  )
}
const routeTree = createRootRoute({ component: SmokePage })
const router = createRouter({ routeTree })
createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)
