# Plan: join-by-QR and the native scanner

Branch: `feat/qr-codes`

Revised after two review passes. Their verdicts, findings, and suggested
phase order are folded in below.

## Goal

An organizer shows or prints a QR code for a tournament. A player scans it,
with the phone's camera app or the scanner built into the native app, and
lands on a join screen with one button. What that button does depends on how
the event is set up:

| Event setup                      | Button                                 | Outcome                                                             |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| Free, no approval                | Join                                   | `registerSelf` → confirmed, seat taken                              |
| Approval mode (the waiting room) | Request to join                        | `registerSelf` → pending, in the organizer's Review Queue           |
| Paid, no approval                | Pay $X                                 | `createEntryCheckout` → Stripe Checkout → webhook confirms the seat |
| Paid + approval mode             | Request to join, then Complete payment | pending → organizer approves → post-approval order → Checkout       |

## Decisions

- **"Waiting room" means approval mode** (`registrationRequiresApproval`).
  No new backend concept. CONTEXT.md has no entry for the admission mode
  itself (Review Queue is the organizer's view of it), so add a short
  "Approval Mode" entry and record "waiting room" as its _Avoid_ alias.
- **Scanning never registers anyone by itself.** It opens a join screen with
  one primary button, the same as landing on the web event page today.
- **The QR code encodes the existing Invite Link**,
  `https://<web origin>/join/<code>`:
  - A phone's camera app opens it on the web today, through the
    `/join/$inviteCode` → event page `?invite=` flow.
  - The app scanner pulls the code out of the same URL.
  - Once universal links ship (PR 5), the same printed code opens the app
    directly, with no reprint.
  - There is one secret and one way to revoke it (rotate or disable). It also
    covers private events.
- **Organizers create QR codes on web only.** The native app has no organizer
  screens, so native gets the player side: the scanner and the join screen.
- **The web organizer QR ships first, on its own.** It's useful as soon as it
  lands, because a camera-app scan already works end-to-end through `/join`.

## Libraries (prebuilt, no hand-rolled QR code)

| Need                      | Choice                                                                                                                                           | Why                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Web QR rendering          | `qrcode.react` 4.2.0 (`QRCodeSVG` on screen and in print, a hidden `QRCodeCanvas` for PNG download)                                              | No dependencies, React 19 peer                                                                               |
| Native scanning           | `expo-camera` ~56.0.8: `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}` and `onBarcodeScanned`, plus `useCameraPermissions` | The SDK 56 first-party module. `expo-barcode-scanner` is gone                                                |
| Native scan feedback      | `expo-haptics` ~56.0.3                                                                                                                           | A tap on a valid scan                                                                                        |
| Native in-app Checkout    | `expo-web-browser` `openBrowserAsync`, a `Linking` listener, and `dismissBrowser()` (already installed, plugin registered)                       | Reuses the existing Stripe Checkout Sessions and webhook unchanged. Avoids the iOS sign-in prompt (see PR 4) |
| Native QR display (later) | `react-native-qrcode-svg` + `react-native-svg` 15.15.4                                                                                           | Not needed in this plan. Add when the app has to show a code, such as a check-in badge                       |

Options considered and not chosen:

- **`expo-camera` `launchScanner()`.** On Android this is the Google code
  scanner: no camera permission, but it lives in Play Services and downloads
  its module on first use. On iOS it is `DataScannerViewController` and needs
  iOS 16+. It's a system modal rather than an embedded view, so it stays a
  fallback if the embedded `CameraView` gives trouble.
- **Stripe PaymentSheet (`@stripe/stripe-react-native` 0.64.0, bundled with
  SDK 56).** It is PaymentIntent-based. Using it would duplicate the
  supersede/attach/compare-and-swap machinery in `payments/checkout.ts:245-262,
369-399` and add a second fulfillment path. Keep it as a later upgrade if the
  browser step hurts conversion.
- **`openAuthSessionAsync` (ASWebAuthenticationSession).** Before every
  session, iOS shows "Paper Pairings Wants to Use … to Sign In", which is the
  wrong message for a payment. `preferEphemeralSession: true` suppresses the
  prompt, but it also drops Safari cookies, which loses Link autofill. The
  result type it returns tells us nothing we need, because we read the order
  reactively anyway.

## Current state

- **Invite links:**
  - Storage and logic: the `tournamentInvites` table and `model/invites.ts`.
    Codes are 10 characters of Crockford base32, about 50 bits. The server's
    `normalizeInviteCode` tolerates lookalike characters, which
    `inviteLinks.convex.spec.ts` pins.
  - Endpoints in `tournaments/invites.ts`: `getInviteLink`,
    `resolveInviteCode`, `regenerateInviteLink`, and `disableInviteLink`.
  - `regenerateInviteLink` is a plain create when no row exists
    (`invites.ts:65-75`).
  - A code opens nothing while the event is in `setup`. A scan then reads as
    "Invite not found" (`invites.ts:45-47`).
- **Private vs public:**
  - The invite code only matters for private events. `registerSelf` checks it
    only when `visibility === "private"` (`registrations.ts:162-169`), and
    `getPublicTournament` only for non-public events (`lifecycle.ts:151-153`).
  - On a public event the code is a no-op, but it still gets printed. If the
    event later goes private, those posters still let people in.
- **Web:**
  - `/join/$inviteCode` redirects to `/tournaments/$id?invite=`.
  - `RegistrationPanel` (`components/tournament-public-page.tsx:255-657`)
    covers free, approval, paid, and post-approval payment, plus the
    dropped/eliminated/in-progress states.
  - `InviteLinkCard` builds `${window.location.origin}/join/${code}`. Its
    Regenerate and Disable buttons don't ask for confirmation.
  - `e2e/README.md:41-42` claims Regenerate/Disable coverage that
    `invite-links.spec.ts` doesn't have.
  - The e2e suite exercises free registration through the invite link and
    nothing else on `RegistrationPanel`: approval, paid, post-approval
    payment, waitlisted, dropped, eliminated, and rejected have no browser
    coverage.
- **Payments:**
  - `createEntryCheckout` builds `successUrl` (`payments/checkout.ts:465`)
    and `eventUrl` (`:516`) from `WEB_APP_ORIGIN`.
  - Fulfillment runs only through the webhook.
  - `getMyEntryOrder` takes a `now` argument (`payments/queries.ts:70`).
    The web supplies it from `useClientClock` (`apps/web/src/hooks/`), whose
    wake-up source is the browser (`document.visibilityState`, window
    focus), and holds the result across ticks with `useStableQuery`, which
    has no browser dependency at all.
  - `mintAndAttachSession` is shared by `createEntryCheckout`
    (`/tournaments/<code>`) and `createBadgeCheckout`
    (`/conventions/<code>`, `checkout.ts:539`).
- **Native:**
  - Expo SDK 56, RN 0.85, expo-router, dev build (CNG; `ios/`/`android/` are
    gitignored), scheme `paperpairings`.
  - expo-router already maps scheme URLs to file routes:
    `paperpairings://tournament/123` opens `tournament/[code].tsx` today. What
    is missing is a `/join/[code]` route, not deep-link plumbing.
  - The `notRegistered` state is a dead end.
  - `usePlayerTournamentAccess` doesn't pass an invite code, and it reduces
    pending, waitlisted, rejected, and cancelled rows to `notRegistered` with
    the row dropped (`player-access.ts:80-82`).
  - There is no camera dependency or permission string, and no native tests.
- **Universal links:** no AASA or `assetlinks.json`, and no
  `associatedDomains`/`intentFilters`. Blocked on the custom domain (TODO §0).
  Until that domain exists, `window.location.origin` is whichever
  deployment the organizer has open, so a poster printed from a Vercel
  preview URL dies with that preview.

## PR 1: organizer QR on web

No backend changes.

1. Add `qrcode.react` to `apps/web`.
   - Import it explicitly. `nodeLinker: hoisted` exposes a stray transitive
     `qrcode`, so never write `from 'qrcode'`.
   - `check:deps` must still pass.
2. Add `components/shared/qr-code.tsx`, a thin wrapper around `QRCodeSVG`:
   - Fixed dark-on-white whatever the theme, `marginSize={4}`, `level="M"`,
     and a `title`.
   - No download helpers in the wrapper.
3. Add a `JoinQrDialog`:
   - **Data:** it reads `getInviteLink`.
     - When that returns null, it shows "Create invite link", which calls
       `regenerateInviteLink` (a plain create when no row exists).
     - It never calls regenerate when a link already exists.
     - `ensureInviteLink` isn't needed. The only case it would close is a
       race between two tabs.
   - **Lifecycle:** the QR code renders only while the event is in
     `registration`.
     - In `setup`: no QR code, only "Publish the event to get a QR code". A
       poster printed before publishing scans as "Invite not found", which
       looks broken.
     - After registration closes (`in_progress`, `completed`, `cancelled`):
       no QR code, only "Registration is closed, so there's nothing to
       scan". `registerSelf` refuses every lifecycle but `registration`, so
       a code printed now would scan to a closed page. The entry points
       below stay visible and open this note, matching how `InviteLinkCard`
       already disables its actions on a cancelled event.
   - **Contents:** the QR code, the event name, the code formatted as
     `XXXXX-XXXXX` for typing in by hand (a local `formatInviteCode`, with a
     dash after 5 characters), and the URL.
   - **Origin:** the URL is `${window.location.origin}/join/<code>`, the
     same as `InviteLinkCard`. That is whichever deployment the organizer
     has open, so a poster printed from a Vercel preview URL stops working
     when the preview does. Acceptable pre-production. Once the custom
     domain exists (TODO §0), source the origin from a public env var so
     every deployment prints the canonical domain; record that under the
     custom-domain item rather than solving it here.
   - **Caption by event setup:** "Scan to join", "Scan to request a spot", or
     "Scan to register — $X entry".
   - **Trust copy:**
     - Private events: "This QR code is the invite. Anyone with a photo of it
       can join. Regenerate to cancel it."
     - Public events: "Making the event private later doesn't cancel this
       code. Regenerate it."
   - **Actions:**
     - Download PNG: a hidden `QRCodeCanvas` at about 1024px, saved with
       `canvas.toBlob`.
     - Print: a `@media print` stylesheet with the QR code, event name, and
       code only. Print preview also works as a full-screen venue display.
     - Present mode and SVG download are cut from v1. Add them if someone
       asks.
4. Entry points:
   - "Show QR code" on `InviteLinkCard`.
   - "QR code" next to "View public page" on the organizer Overview
     (`tournament-overview-view.tsx:73-83`).
5. Regenerate and Disable each get an `AlertDialog` saying that shared links
   and printed QR codes will stop working. Rotation is the only way to revoke
   a code, so this is a must, not polish.
6. Extend `e2e/invite-links.spec.ts`:
   - The dialog opens, the rendered URL matches the invite link, and the SVG
     is present.
   - Setup-stage events show no QR code, and neither do events whose
     registration has closed.
   - The Regenerate and Disable confirmations.
   - Make `e2e/README.md` match what the spec covers.

## PR 2a: native join screen (free and approval mode)

Everything here is reachable through simulator deep links. No native module
is installed, so no dev-client rebuild and no device. The scanner (PR 2b)
and the web-to-app bridge (PR 2c) build on it separately, so a reviewer
never sees a pure-function refactor mixed with a native module install.

1. **Rename `tournament/[code]` to `tournaments/[code]`** so the native path
   matches the web.
   - Update the `router.push` at `index.tsx:89-92` and the `Stack.Screen`
     name in `_layout.tsx`.
   - Pre-production, so no compatibility shim. This removes the need for a
     `+native-intent.tsx` rewrite in PR 5.
2. **Add `@paper-pairings/shared/app-links`.**
   - `parseAppLink(raw)` returns `{ kind: 'join', inviteCode } | null`.
   - It accepts `…/join/<code>` on any host, `paperpairings://join/<code>`,
     and a bare code (10 alphanumerics after stripping spaces and dashes).
   - The server's `normalizeInviteCode` stays the only authority on the code.
     The invite helpers don't move into shared.
   - No origin allow-list and no env var. The scanner never opens a scanned
     URL; it only extracts a code and resolves it against our backend, so a
     lookalike-domain QR code can't phish anyone.
   - The union is where future QR kinds get added.
   - vitest table tests.
3. **Change `usePlayerTournamentAccess`** (`packages/tournament-core`):
   - Take an optional `inviteCode` and pass it to `getPublicTournament`.
   - Include `registration: PlayerRegistration | null` on `notRegistered`, so
     callers can tell pending, waitlisted, rejected, and cancelled apart.
   - Update `player-access.test.ts`.
4. **Add `deriveJoinAction` in core.** It's a pure function, limited to what
   the join screen needs.
   - Inputs: tournament flags, the viewer's auth, the registration row, the
     order, the badge gate, `badgeCompsThisEvent` (getPublicTournament's
     `convention.myBadgeCompsThisEvent`), and spots left.
   - Outputs: `signIn | register | requestToRegister | pay | completePayment
| pendingReview | waitlisted | registered | rejected | full | closed |
badgeBlocked`.
   - `register` and `requestToRegister` carry `comped: boolean`. A comped
     viewer on a paid event never gets `pay`: the server refuses a comped
     checkout and files the comp through `registerSelf` (ADR 0004), and the
     web panel already routes them to the free button with "included with
     your convention badge". Without this input the derivation can't
     replace `RegistrationPanel` in PR 3.
   - Table tests cover {free, approval, paid, paid+approval} × each state,
     plus comped × paid and comped × paid+approval. Include approval × full:
     `registerSelf` refuses applications at capacity
     (`registrations.ts:212`).
5. **Add `src/app/join/[code].tsx`.** The path matches the web, so universal
   links route here later without a rewrite.
   - **Data:**
     - `resolveInviteCode`
     - `getPublicTournament` with the invite code
     - the registration row from the updated access hook
     - `getFeePreview` (`payments/queries.ts:23`) for the "Pay $X" label
     - spots left
   - **Screen:** the event summary (name, date, venue, fee, spots left, and
     an approval-mode note) and the button from `deriveJoinAction`:
     - Signed out: the existing `SignInButton` modal. The route params
       survive the modal.
     - Join (including comped): `registerSelf`, then
       `router.replace('/tournaments/<publicCode>')`.
     - Request to join: `registerSelf`, then a live "Waiting for organizer
       approval" state with Withdraw (`cancelMyRegistration`).
     - Pay or Complete payment, until PR 4 lands: a "Pay on the web" button
       that opens the web join URL in `expo-web-browser`. The in-app
       browser carries no Clerk session, so the player signs in again
       there; the caption says so: "You'll sign in again on the web to
       pay."
     - Registered: a status card with "Open the event", which does the same
       `router.replace`.
     - Pending, waitlisted, rejected, full, or closed: a status card.
     - Badge-gated convention child events: a status card that opens the
       convention page on the web.
     - Unknown, disabled, or setup-stage code: "Invite not found".
6. **Fix the `notRegistered` dead end on `tournaments/[code]`:** render the
   same join panel there, without an invite code, using the registration row
   the hook now exposes.

## PR 2b: native scanner

Needs a dev-client rebuild and physical devices (expo-camera is device-only).

1. **Install:**
   `pnpm --filter @paper-pairings/native exec expo install expo-camera expo-haptics`.
   - Add the plugin to `app.config.ts` by hand. `expo install` can't write to
     the dynamic config:
     `["expo-camera", { cameraPermission: "Paper Pairings uses the camera to scan tournament QR codes.", microphonePermission: false, recordAudioAndroid: false }]`.
   - `microphonePermission: false` keeps `NSMicrophoneUsageDescription` out
     of Info.plist. `android.permission.CAMERA` is always added.
   - Rebuild the dev client.
2. **Add `src/app/scan.tsx`**, presented as a full-screen modal:
   - Embedded `CameraView` with a viewfinder overlay and a torch toggle
     (`enableTorch`).
   - Permission states: an explainer before asking; when denied,
     `Linking.openSettings()`.
   - **Scan lock:**
     - `onBarcodeScanned` fires continuously while a code is in view, so
       pass `undefined` while locked and ignore the same `data` for about
       1.5 s.
     - Re-arm in `useFocusEffect`, so backing out of the join screen lets the
       player scan again.
   - Haptic feedback on a valid scan.
   - A QR code from somewhere else shows a "Not a Paper Pairings code" toast
     and never opens the URL.
   - "Type a code instead" sends the raw text and lets the server normalize
     it. This also lets you test on a simulator.
   - A valid code does `router.push('/join/<code>')`, into PR 2a's screen.
3. **Home screen:**
   - A Scan button in the header. `expo-symbols` `qrcode.viewfinder` is
     iOS-only, so give it a `fallback` (a text label or a bundled image) for
     Android.
   - A "Scan a QR code to join" call to action in the empty state.

## PR 2c: web-to-app bridge (optional, until universal links exist)

- On the mobile web event page reached through `/join`, add an "Open in the
  app" link to `paperpairings://join/<code>`.
- Only on tap, never as an auto-redirect, since the link does nothing
  without the app installed.
- Add a Smart App Banner once the app is in the store.

## PR 3: web `RegistrationPanel` onto the core derivation

- Widen `deriveJoinAction`, or wrap it in a `deriveRegistrationAction`, to
  cover the web-only states:
  - dropped / eliminated / disqualified
  - in-progress "open my player view"
  - refund flags
  - cancel registration
- Refactor `RegistrationPanel` (`tournament-public-page.tsx:255-657`) to
  render from it.
- Its own diff, with no behavior change.
- **Build the safety net first.** The e2e suite only covers free
  registration through the invite link (see Current state), so it would not
  catch a regression in any other branch. Before touching the panel, extend
  the table tests so every branch it has today is a row asserting the
  current output: confirmed × active / dropped / disqualified / eliminated
  by lifecycle, pending with and without a payable order (and
  `post_approval` vs direct), waitlisted, rejected, closed, full,
  badge-gated, comped, paid direct, approval, and the repeat-drop refund
  flag. Those rows are characterization tests of the panel as it is; the
  refactor then has to keep them green.

## PR 4: native payment

1. **Spike first. Both are quick.**
   - Create a test-mode Checkout Session with
     `success_url=paperpairings://x` through the Stripe CLI, and see whether
     Stripe accepts it.
   - Stripe's docs don't forbid custom schemes, but they recommend a
     universal link plus a fallback page, which is the bounce page described
     below.
   - On a device, check the browser choice and Apple Pay availability inside
     `openBrowserAsync`.
2. **Backend:**
   - Add `returnTo: v.optional(v.literal('app'))` to `createEntryCheckout`,
     passed through `beginEntryCheckout` and `mintAndAttachSession`.
   - Pull a pure `checkoutReturnUrls(origin, eventPath, returnTo)` out of
     `successUrl` (`checkout.ts:465`) and `eventUrl` (`:516`). It takes the
     event path, not a tournament code, because `mintAndAttachSession` also
     serves `createBadgeCheckout` (`/conventions/<code>`). With `'app'`,
     both URLs point at the payment route with `app=1`.
   - Only `createEntryCheckout` accepts `returnTo` in this PR. Badge
     checkout stays web-only and passes `undefined`; the spec pins that its
     URLs are unchanged.
   - It's an enum and never a caller-supplied URL, so there's no open
     redirect.
   - When `returnTo === 'app'`, pass `origin_context: 'mobile_app'` in the
     session create (`stripe/client.ts:208-227`). Stripe documents it as the
     app-to-web optimized UI.
   - Specs: the URL builder, and `returnTo` reaching the session.
3. **Shared hooks, not a native fork:**
   - Move `useStableQuery` to `@paper-pairings/core` unchanged. It uses only
     `convex/react` and a ref; nothing in it is browser-specific.
   - Move `roundedClock`, `CLIENT_CLOCK_RESOLUTION_MS`, and the
     bucket-boundary scheduling of `useClientClock` into core, with the
     wake-up source injected as `subscribeToWake(refresh) => unsubscribe`.
     The web wrapper passes `visibilitychange` + window focus; the native
     wrapper passes `AppState` 'change' → 'active'. One copy of the rounding
     rule (`round: 'up'` matters for the refund verdict), two thin platform
     wrappers. The two hook tests move with them.
   - `getMyEntryOrder` needs `now`.
4. **Payment-status dispatch:** pull the status dispatch out of
   `apps/web/src/components/shared/payment-return.tsx` into core, so native
   shows the same outcomes.
5. **Native flow:**
   - Split `tournaments/[code].tsx` into `tournaments/[code]/index.tsx` and
     `tournaments/[code]/payment.tsx`.
   - Pay and Complete payment call
     `createEntryCheckout({ ..., returnTo: 'app' })`, then
     `WebBrowser.openBrowserAsync(url)`.
   - A `Linking` 'url' listener catches `paperpairings://…/payment`, calls
     `WebBrowser.dismissBrowser()`, and navigates to the payment screen.
   - Closing the browser by hand also lands on the payment screen.
   - Stripe holds the success redirect until our webhook acknowledges
     `checkout.session.completed`, up to 10 s, so in deployed environments
     the order is usually already `paid` when the app gets focus back. That
     wait is skipped when events are forwarded through the Stripe CLI, so a
     local run lands on `awaiting_payment` first and says nothing about the
     timing. The screen reads the order reactively either way, with the
     same pending card the web shows; `session_id` is only a hint.
   - **Android:** `dismissBrowser` is iOS-only (a no-op on Android), so the
     Custom Tab stays in the task and Back may show the stale Stripe page.
     The one lever is `createTask: false`, which keeps the tab in the app's
     task. `showInRecents` is not it: it requires `createTask: true`, and
     `useProxyActivity` (default true) overrides it anyway. Test on a
     device.
6. **Web return page when `app=1`:**
   - The primary UI on both platforms is a "Return to the app" button that
     links to `paperpairings://tournaments/<code>/payment`.
   - An automatic `window.location.replace` to the same URL is only a nicety
     for iOS. Android Chrome blocks script-initiated navigation to an
     external scheme when there was no user gesture, which is the case after
     Stripe's redirect.
   - Cancelling returns the same way.
7. **Docs:** add the native flow, `returnTo`, and the Android caveat to
   `docs/payments.md`.

## PR 5: universal links

Blocked on the custom domain, the Apple Team ID, and the Android signing cert
(there's no `eas.json` yet).

- Add `apps/web/public/.well-known/apple-app-site-association` and
  `assetlinks.json`, with a Vercel header for `application/json` and no
  redirect.
- Native config: `ios.associatedDomains: ["applinks:<domain>"]` and Android
  `intentFilters` with `autoVerify`.
- **Claim `/join/*` only.**
  - Claiming `/tournaments/*` would send an organizer who taps "View public
    page" on an iPhone into the player app, which has no organizer screens.
  - Widen the claim only once the app has somewhere sensible to put every
    `/tournaments/<code>` visitor.
- No `+native-intent.tsx`, because PR 2a's route rename lines the paths up.
- Result: a phone's camera app opens the app directly when it's installed.
  Printed codes don't change.

## Security notes

- **The poster is the exposure, not guessing.**
  - The invite code is a bearer secret printed with no expiry.
  - At 50 bits, guessing is moot. `resolveInviteCode` is a query, so it can't
    be rate-limited (queries can't write; `docs/rate-limiting.md:55`).
  - Rotation is the only way to revoke a code, and it kills every poster at
    once. Hence the PR 1 confirmations and trust copy.
- **Scanned URLs are never opened.** The scanner extracts a code and checks it
  against our backend; anything else gets a toast.
- **`returnTo` is an enum**, so checkout can't be made to redirect anywhere
  else.
- **The invite only grants entry.** It never overrides an entry decision,
  capacity, or lifecycle (CONTEXT.md "Invite Link"). This plan doesn't change
  that.

## App Review notes (for the native submission)

- **3.1.1** lists QR codes among the mechanisms that must not unlock in-app
  content. Say plainly that the QR code joins an in-person event and unlocks
  nothing digital.
- **3.1.3(e):** the entry fee pays for a service used outside the app, and
  for that the guidelines require purchase methods other than in-app
  purchase. Stripe Checkout is the correct path, not a gray area.

## Docs and roadmap

- **CONTEXT.md:**
  - Add a "Join QR" entry: the QR form of the Invite Link, the rotation rule,
    no QR code during setup, and the posters-outlive-going-private note.
  - Add an "Approval Mode" entry: the `registrationRequiresApproval`
    admission mode, where `registerSelf` files a pending application and the
    Review Queue decides it. _Avoid_: waiting room.
- **TODO.md:**
  - PR 1 goes under §3 (admission).
  - Under the custom-domain item in §0, add the printed-QR origin follow-up
    from PR 1: once the domain exists, print it from a public env var, not
    `window.location.origin`.
  - PR 2a, 2b, 2c, and PR 4's native items go under §8's native-parity
    list.
  - PR 4's backend `returnTo` goes under §9 (payments).
  - Mark PR 5 "(blocked on custom domain, Apple Team ID, Android signing
    cert)".
  - Add a line for Maestro device E2E (supported by EAS Workflows), so the
    device matrix doesn't stay manual forever.
- **docs/payments.md:** the native flow (PR 4).
- **apps/web/e2e/README.md:** coverage that matches the spec (PR 1).

## Verification

- `pnpm check`. The new tests are:
  - shared: `app-links`
  - core: `deriveJoinAction` (including approval × full and the comped
    rows), the updated `player-access`, the PR 3 characterization rows for
    `RegistrationPanel`, the payment dispatch, and the moved
    `useClientClock` / `useStableQuery` tests
  - backend: `checkoutReturnUrls` (tournament and convention paths),
    `returnTo` threading, and badge checkout URLs unchanged
  - web: e2e
- **Simulator deep links cover the whole of PR 2a without a camera**,
  because expo-router already handles the scheme:
  - `pnpm dlx uri-scheme open "paperpairings://join/<CODE>" --ios` (or
    `--android`). `uri-scheme` is Expo's wrapper around the two commands
    below.
  - Without it: `xcrun simctl openurl booted "paperpairings://join/<CODE>"`
    on iOS, and
    `adb shell am start -a android.intent.action.VIEW -d "paperpairings://join/<CODE>"`
    on Android.
  - Cases: free / approval / paid / paid + approval, a comped badge holder
    on a paid event, a badge-gated child event, private event, disabled or
    rotated code, setup-stage code, signed out then sign in, event full,
    approval mode while full, already registered.
- **Physical devices only** (expo-camera is device-only), for PR 2b and PR
  4, on an iPhone and an Android phone:
  - the scanner: lock and re-arm, a QR code from somewhere else, torch
  - camera permission denied, then allowed through Settings
  - haptics
  - the PR 4 payment round trip, including the Android Custom Tab
    back-stack check
- Use the `verify` skill for the web organizer flow.

## Later QR uses this sets up

The scanner routes through `parseAppLink`'s union, and `QrCode` is generic.
That leaves room for:

- player check-in or ID badges, which need `react-native-qrcode-svg`
- QR codes on printed result slips (TODO §8)
- convention invite links (TODO §4)
