import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from '@tanstack/react-router'
import { ClerkProvider, useAuth } from '@clerk/tanstack-react-start'
import { shadcn } from '@clerk/themes'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { createServerFn } from '@tanstack/react-start'
import * as React from 'react'
import { auth } from '@clerk/tanstack-react-start/server'
import { ConvexClerkAuthProvider } from '@paper-pairings/core'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import type { ConvexReactClient } from 'convex/react'
import type { QueryClient } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/theme-provider'
import appCss from '@/styles/app.css?url'

const fetchClerkAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { getToken, userId } = await auth()
  const token = await getToken({ template: 'convex' })

  return {
    userId,
    token,
  }
})

// What beforeLoad adds to the router context, with the pathname the answer
// was fetched for (see beforeLoad).
type RootAuthContext = {
  userId: string | null
  authPathname: string
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexClient: ConvexReactClient
  convexQueryClient: ConvexQueryClient
}>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Paper Pairings',
      },
      {
        name: 'description',
        content:
          'Organizer workspaces and event operations for Magic tournaments.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'manifest', href: '/site.webmanifest' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  beforeLoad: async ({
    cause,
    context,
    location,
    matches,
  }): Promise<RootAuthContext | undefined> => {
    // Who is signed in can only change between pages. A navigation that only
    // rewrites the search params of the page already shown (the tournament
    // tables keep their filters there) keeps the last answer instead of
    // paying a server round trip per chip click or pause in typing. `cause`
    // alone cannot tell: the root stays matched across every client-side
    // navigation, so the answer records the page it was fetched for, and the
    // root match (always first) still carries it here. Returning nothing
    // leaves that context in place.
    const previous = matches[0].context as Partial<RootAuthContext>
    if (cause === 'stay' && previous.authPathname === location.pathname) {
      return
    }

    const { userId, token } = await fetchClerkAuth()
    // During SSR only (the only time serverHttpClient exists),
    // set the Clerk auth token to make HTTP queries with.
    if (token) {
      context.convexQueryClient.serverHttpClient?.setAuth(token)
    }

    return {
      userId,
      authPathname: location.pathname,
    }
  },
  component: RootComponent,
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })

  return (
    // The shadcn theme reads this app's CSS tokens, so Clerk's widgets follow
    // the light/dark toggle along with everything else.
    <ClerkProvider appearance={{ theme: shadcn }}>
      <ConvexClerkAuthProvider client={context.convexClient} useAuth={useAuth}>
        <RootDocument>
          <Outlet />
        </RootDocument>
      </ConvexClerkAuthProvider>
    </ClerkProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the ThemeProvider's pre-hydration script adds
    // the theme class before React hydrates, so the html class attribute
    // legitimately differs from the server-rendered markup.
    <html
      lang="en"
      className="h-full antialiased font-sans"
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
