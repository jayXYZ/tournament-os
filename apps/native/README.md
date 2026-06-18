# @tournament-os/native

The Expo (React Native) mobile app players use during tournaments. It shares the
Convex backend (`@tournament-os/backend`) and platform-agnostic player hooks
(`@tournament-os/core`) with the web app, and authenticates against the same
Clerk instance.

## Stack

- **Expo SDK 56** + **expo-router** (file-based routing, `src/app`)
- **Clerk** (`@clerk/expo`) for auth, using the **prebuilt native components**
  (`<AuthView />`, `<UserButton />`) and a `SecureStore` token cache
- **Convex** (`ConvexProviderWithClerk`) for realtime data
- Shared workspace packages: `@tournament-os/backend`, `@tournament-os/core`

## ⚠️ Requires a development build (not Expo Go)

The Clerk native UI components (`<AuthView />`, `<UserButton />`) use native
modules and the `@clerk/expo` config plugin, so this app **cannot run in Expo
Go**. You need to compile a development build once:

```sh
pnpm install
pnpm --filter @tournament-os/native ios       # expo run:ios  (builds + installs the dev client)
# or
pnpm --filter @tournament-os/native android    # expo run:android
```

`expo run:ios` prebuilds the native `ios/` project and compiles it — the first
run takes a few minutes and needs Xcode (+ CocoaPods). It installs the dev
client and starts Metro.

After the dev build is installed on the simulator/device, day-to-day you only
need the Metro dev server (`expo start`, which opens in the dev client):

```sh
pnpm dev:native
```

Re-run `expo run:ios` only when native dependencies or config plugins change
(e.g. adding a new Expo module).

## Setup

1. Copy env and fill in values (defaults already point at the shared dev
   deployment / Clerk app):
   ```sh
   cp .env.example .env.local
   ```
   - `EXPO_PUBLIC_CONVEX_URL` — same as `apps/web`'s `VITE_CONVEX_URL`
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` — same Clerk app as the web app

> Clerk must have a JWT template named `convex` (the web app already relies on
> it) for authenticated Convex queries to work.

## Layout

```
src/
  app/
    _layout.tsx          # Clerk + Convex providers, root Stack
    index.tsx            # Auth gate: <AuthView> modal when signed out,
                         #   <UserButton> + the player's active tournaments when in
    tournament/[id].tsx  # Current match + live standings (shared core hooks)
  lib/
    convex.ts            # ConvexReactClient singleton
```

## Monorepo notes

- The repo uses `node-linker=hoisted` (root `.npmrc`) — Expo/Metro's
  recommended pnpm layout.
- `metro.config.js` watches the workspace root and resolves modules from both
  the app and root `node_modules`.

## Next steps

Reporting/confirming results and dropping are already available as shared hooks
(`useReportResult`, `useConfirmResult`, `useDropSelf`) — wire them into
`tournament/[id].tsx` to let players submit match results from their phone.
