"use client";

import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { ArrowLeft, LogIn, Swords } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OrganizerWorkspace } from "@/app/components/organizer-workspace";

export default function AdminPage() {
  return (
    <main className="min-h-svh bg-stone-100 text-stone-950">
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutAdmin />
      </Unauthenticated>
      <Authenticated>
        <OrganizerWorkspace />
      </Authenticated>
    </main>
  );
}

function SignedOutAdmin() {
  const { refreshAuth } = useAuth();

  return (
    <section className="flex min-h-svh flex-col bg-stone-950 text-stone-50">
      <header className="flex min-h-16 items-center justify-between border-b border-white/10 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-emerald-300 text-stone-950">
            <Swords className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Tournament OS</p>
            <p className="mt-1 text-xs text-stone-400">Organization controls</p>
          </div>
        </div>
        <Button asChild type="button" variant="outline" className="border-white/20 text-stone-50 hover:bg-white/10">
          <Link href="/">
            <ArrowLeft className="size-4" />
            Player view
          </Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-200">
          Admin access
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-normal text-white sm:text-5xl">
          Sign in to manage your organization.
        </h1>
        <p className="mt-5 text-base leading-7 text-stone-300">
          Organization creation, staff invites, and tournament operations live in
          the admin workspace.
        </p>
        <div className="mt-8">
          <Button
            type="button"
            size="lg"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
            className="h-11 bg-emerald-300 px-4 text-sm text-stone-950 hover:bg-emerald-200"
          >
            <LogIn className="size-4" />
            Sign in
          </Button>
        </div>
      </div>
    </section>
  );
}
