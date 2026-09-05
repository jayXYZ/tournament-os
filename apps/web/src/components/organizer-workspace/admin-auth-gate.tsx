import { Link } from '@tanstack/react-router'
import { AuthLoading, Authenticated, Unauthenticated } from 'convex/react'
import { ArrowLeft, LogIn } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppAuth } from '@/lib/use-app-auth'

import { BrandMark } from '@/components/shared/brand-mark'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function AdminAuthGate({
  children,
  description = 'Organization creation, staff invites, and tournament operations live in the admin workspace.',
}: {
  children: ReactNode
  description?: string
}) {
  // Colors come from the theme tokens only: anything hardcoded here would
  // cascade into the whole authenticated workspace and ignore the mode toggle.
  return (
    <main className="min-h-svh bg-background text-foreground">
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center">
          <Spinner className="size-8 text-muted-foreground" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutAdmin description={description} />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </main>
  )
}

function SignedOutAdmin({ description }: { description: string }) {
  const { refreshAuth } = useAppAuth()

  return (
    <section className="flex min-h-svh flex-col">
      <header className="flex min-h-16 items-center justify-between border-b border-border px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <div>
            <p className="text-sm font-semibold leading-none">Paper Pairings</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Organization controls
            </p>
          </div>
        </div>
        <Button asChild type="button" variant="outline">
          <Link to="/">
            <ArrowLeft className="size-4" />
            Player view
          </Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Admin access
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">
          Sign in to manage your organization.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          {description}
        </p>
        <div className="mt-8">
          <Button
            type="button"
            size="lg"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
            className="h-11 px-4 text-sm"
          >
            <LogIn className="size-4" />
            Sign in
          </Button>
        </div>
      </div>
    </section>
  )
}
