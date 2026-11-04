# @paper-pairings/native

The Expo (React Native) mobile app players use during tournaments. It shares the
Convex backend (`@paper-pairings/backend`) and platform-agnostic player hooks
(`@paper-pairings/core`) with the web app, and authenticates against the same
Clerk instance.

## Stack

- **Expo SDK 56** + **expo-router** (file-based routing, `src/app`)
- **Clerk** (`@clerk/expo`) for auth, using the **prebuilt native components**
  (`<AuthView />`, `<UserButton />`) and a `SecureStore` token cache
- **Convex** (`ConvexProviderWithClerk`) for realtime data
- **Sentry** wired into the app (`_layout.tsx`) and Metro (`getSentryExpoConfig`)
- Shared workspace packages: `@paper-pairings/backend`, `@paper-pairings/core`

> ⚠️ `@clerk/expo` is pinned **exactly** at `3.4.6` behind a Swift 6 pnpm patch
> (`patches/@clerk__expo.patch`, version-qualified in `pnpm-workspace.yaml` so a
> bump fails loudly). Don't bump it without redoing the patch.

## ⚠️ Requires a development build (not Expo Go)

The Clerk native UI components (`<AuthView />`, `<UserButton />`) use native
modules and the `@clerk/expo` config plugin, so this app **cannot run in Expo
Go**. You need to compile a development build once:

```sh
pnpm install
pnpm --filter @paper-pairings/native ios       # expo run:ios  (builds + installs the dev client)
# or
pnpm --filter @paper-pairings/native android    # expo run:android
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
(e.g. adding a new Expo module). `ios/` is generated and gitignored; if
`pod install` reports version mismatches after a dependency bump, regenerate
it with `pnpm --filter @paper-pairings/native exec expo prebuild --platform ios --clean`.
Xcode 27 refuses pod targets below iOS 15, so `app.config.ts` lifts them to
15.1 in the generated Podfile.

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
    tournaments/[code].tsx # The event page, keyed by the tournament's public
                           #   code (shared core hooks): the join panel until
                           #   the viewer holds a seat, then the report
                           #   scoreboard while their match is reportable and
                           #   the result card after
    join/[code].tsx        # /join/<code> from a scanned QR, shared link, or
                           #   typed code: resolves either code kind and shows
                           #   the join panel
    dev/[action].tsx       # __DEV__-only session links for test runs
                           #   (see "Headless sign-in for test runs")
  components/
    report-result-scoreboard.tsx # Game-win counts stepped by tapping the
                                 #   upper/lower half of each numeral, draws
                                 #   behind a prompt, hold to submit
    join-event-view.tsx  # The join panel: event summary and the one action
                         #   deriveJoinAction (core) picks, or its status
    unverified-viewer-shell.tsx # Whole-screen recovery for the auth gate's
                         #   unverified state, shared by the player screens
    hold-button.tsx      # Native port of the web HoldButton (800ms sweep)
    round-timer-pill.tsx # App-bar timer pill, unmounted until the custom
                         #   header lands (iOS 26 glass wraps header items)
    toast.tsx            # One-at-a-time bottom toast (sonner stand-in)
  lib/
    convex.ts            # ConvexReactClient singleton
    palette.ts           # Dark-theme tokens mirrored from the web app.css
    typography.ts        # Scoreboard numeral face (Geist), loaded without gating start
```

## Headless sign-in for test runs

Sign-in is Google OAuth through Clerk's native `AuthView`, which a test runner
cannot drive. Development builds accept two session links instead
(`src/app/dev/[action].tsx`):

- `paperpairings://dev/sign-in?ticket=<ticket>` ends any current session,
  redeems a Clerk sign-in ticket (`signIn.create({ strategy: "ticket" })`,
  then `setActive`), and returns to the screen it opened over, or home.
- `paperpairings://dev/sign-out` ends the session the same way.

Mint a ticket with the Clerk Backend API and `CLERK_SECRET_KEY` from
`apps/web/.env.local` (development instance only), as the web `verify` skill
does: `POST https://api.clerk.com/v1/sign_in_tokens` with `{ "user_id": … }`.
Tickets are single-use credentials: the route never logs, stores, or shows
one. A release build (`__DEV__` false) renders a refusal and does nothing.

## Device E2E (Maestro)

The join screen's deep-link matrix runs as [Maestro](https://maestro.dev)
flows on an iOS simulator, with no camera: `e2e/flows/` holds one flow per
scenario (`docs/plans/qr-join.md`, "Verification") and `e2e/run.mjs` drives
them.

```sh
pnpm dev:native                                  # Metro, in its own terminal
pnpm --filter @paper-pairings/native e2e:ios     # every flow
pnpm --filter @paper-pairings/native e2e:ios 05-comped.yaml 14-signed-out-then-sign-in.yaml
```

Each run:

1. finds or creates the Clerk user `e2e-native-player@example.com`;
2. seeds a fresh organization and its events on the dev deployment named by
   `packages/backend/.env.local` (it refuses anything but a `dev:`
   deployment), through the public mutations called with
   `convex run --identity`, plus `devSeed:markOrganizationPayoutsReady`, a
   stand-in Stripe account that paid events need and that refuses to run
   off a Clerk development instance;
3. serves single-use sign-in tickets on a loopback port for the flows'
   sign-in step, so `CLERK_SECRET_KEY` never reaches Maestro;
4. runs `maestro test` against the booted simulator.

Prerequisites:

- Xcode with a booted iPhone simulator (`xcrun simctl boot <udid>`; pick one
  with `E2E_DEVICE=<udid>` when several are booted) and the dev client
  installed on it (`pnpm --filter @paper-pairings/native ios`).
- Metro running on `http://127.0.0.1:8081` (override with `E2E_METRO_URL`).
  The paid flows read `EXPO_PUBLIC_WEB_ORIGIN` the way Metro does (shell,
  then `.env.local`); start Metro and the runner with the same value.
- Maestro, installed per user, never into the repo:
  `curl -Ls "https://get.maestro.mobile.dev" | bash` (puts it under
  `~/.maestro`; set `MAESTRO_BIN` to use another). Maestro needs Java 17+;
  without a system JDK, unpack one under `~/.maestro/jdk/` and the runner
  sets `JAVA_HOME` from it.
- `apps/web/.env.local` with the development `CLERK_SECRET_KEY`, and a
  logged-in Convex CLI for the dev deployment, with this branch's functions
  pushed (`pnpm --filter @paper-pairings/backend exec convex dev --once`).

Runs accumulate organizations named `E2E Native Join <run id>` in the dev
deployment; `pnpm db:wipe` clears them. Seeded paid events cannot take
payment (their Stripe account is a stand-in), so the flows stop at the
join screen's hand-off. Android, the camera scanner, haptics, the torch, and
the Stripe round trip are not covered; they need an emulator or physical
devices. Results are recorded in
[delivery status](../../docs/delivery-status.md).

## Monorepo notes

- The repo uses `nodeLinker: hoisted` (set in `pnpm-workspace.yaml`) —
  Expo/Metro's recommended pnpm layout.
- `metro.config.js` just wraps `getSentryExpoConfig`; Expo's default config
  detects the monorepo on its own.

## Delivery and next steps

Result reporting is implemented in the match scoreboard and merged through
PR #31. There is no opponent confirmation step. Dropping has a shared hook
(`useDropSelf`) but still needs a native control. The custom app/tab bars,
standings, match history, and decklists remain open in
[roadmap section 8](../../TODO.md#8-event-day-outputs-and-client-parity).

Free/approval joining at `/join/<code>` and a web payment handoff are built
on `feat/qr-codes`, not merged into the audited `main`. The scanner, native
payment return flow, and universal links remain planned. Do not treat those
branch routes or environment variables as available in this checkout.

The native build script and CI export iOS and Android bundles only. The web
target remains an open fix-or-remove task. Exporting bundles does not verify
device behavior or Sentry capture; record those checks in
[delivery status](../../docs/delivery-status.md).
