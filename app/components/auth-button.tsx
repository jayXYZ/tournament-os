"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";

export function AuthButton() {
  const { user, loading, refreshAuth, signOut } = useAuth();

  if (loading) {
    return (
      <span className="inline-flex h-12 w-24 items-center justify-center rounded-full border border-black/[.08] dark:border-white/[.145]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </span>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {user.email}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-base font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void refreshAuth({ ensureSignedIn: true })}
      className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
    >
      Sign in
    </button>
  );
}
