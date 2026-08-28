import { useEffect } from 'react'
import { createRouter } from '@tanstack/react-router'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { QueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/tanstackstart-react'
import { routeTree } from './routeTree.gen'
import type { ErrorComponentProps } from '@tanstack/react-router'

function DefaultErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (import.meta as any).env.DEV ? (
    <pre>{error.stack}</pre>
  ) : (
    <p>Something went wrong. Please try again.</p>
  )
}

export function getRouter() {
  const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!
  if (!CONVEX_URL) {
    throw new Error('missing VITE_CONVEX_URL envar')
  }
  const convex = new ConvexReactClient(CONVEX_URL, {
    unsavedChangesWarning: false,
  })
  const convexQueryClient = new ConvexQueryClient(convex)

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        gcTime: 5000,
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = routerWithQueryClient(
    createRouter({
      routeTree,
      defaultPreload: 'intent',
      scrollRestoration: true,
      defaultPreloadStaleTime: 0, // Let React Query handle all caching
      defaultErrorComponent: DefaultErrorComponent,
      defaultNotFoundComponent: () => <p>not found</p>,
      context: { queryClient, convexClient: convex, convexQueryClient },
      Wrap: ({ children }) => (
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      ),
    }),
    queryClient,
  )

  if (!router.isServer) {
    Sentry.addIntegration(
      Sentry.tanstackRouterBrowserTracingIntegration(router),
    )
  }

  return router
}
