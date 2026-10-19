# Plan: join-by-QR and the native scanner

Branch: `feat/qr-codes`

Revised after two review passes, a third that split the event identifier
from the invite grant (PR 0), and a fourth over the PR 0 implementation that
moved the order query and clock hooks into PR 2a and added the PR 4
cancel/dismiss handling and the PR 2b camera lifecycle. Their verdicts,
findings, and suggested phase order are folded in below.

Status: PR 0, PR 1, and PR 2a are built. PR 2b (the scanner) is next.

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
  No new backend concept. The waiting room is the player's side of the
  Review Queue: the players there are waiting for the organizer to decide
  their application.
  - CONTEXT.md has no entry for the setting itself, so add an "Approval
    Mode" entry.
  - "Waiting room" is not an _Avoid_ term, but it stays out of the glossary
    unless it ends up in UI copy. If it does, add it as the player-side name
    for the Review Queue, after settling two edges:
    - Approved-but-unpaid players are outside the Review Queue, so they are
      outside the waiting room too. They're waiting on themselves, not the
      organizer.
    - Waitlisted players have already been decided, so they are outside the
      queue. But they are still waiting, and `approveEntry` still accepts
      them. Decide whether they count as in the waiting room.
  - Player copy is still open. Until it's decided, native uses the web's
    existing strings (`tournament-public-page.tsx:525-531, 636-637`):
    "Registration pending organizer approval", "Registration submitted for
    organizer approval.", "You're on the waitlist", and "Application
    approved — payment required". "Waiting room" can suggest a live lobby
    with a place in line, while these say who acts next.
- **Scanning never registers anyone by itself.** It opens a join screen with
  one primary button, the same as landing on the web event page today.
- **Identifier and grant are two different things.** An event's public code
  is its stable identifier: it sits in bookmarks, Stripe return URLs, payment
  metadata, and printed slips, so it can never rotate. The Invite Link is a
  grant: it opens a private event and has to be revocable, so it rotates.
  One value can't do both jobs. Public and unlisted events need only the
  identifier; private events need both.
  - Today the public code is a sequential integer (100001, 100002, …), so
    anyone can count through unlisted events, and the invite link is the
    only short URL worth printing for any event. PR 0 makes the public code
    random.
  - Public and unlisted events: the QR code encodes
    `https://<web origin>/join/<publicCode>`. No invite row, nothing to
    rotate. If the event later goes private, the poster stops admitting
    anyone, which is the right outcome rather than a leak.
  - Private events: the QR code encodes
    `https://<web origin>/join/<inviteCode>`, the existing Invite Link with
    its existing 50-bit secret.
  - One `/join/<code>` route takes both. The lengths are fixed constants (6
    for a public code, 10 for an invite code), so the server tells them
    apart. "Type a code" stays one code either way.
  - A phone's camera app opens the URL on the web today; the app scanner
    pulls the code out of the same URL; once universal links ship (PR 5),
    the same printed code opens the app directly, with no reprint.
- **Organizers create QR codes on web only.** The native app has no organizer
  screens, so native gets the player side: the scanner and the join screen.
- **PR 0 ships first, then the web organizer QR on its own.** PR 0 stands
  alone (unlisted events can no longer be found by counting). PR 1 is useful as soon as it
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

- **Public codes:**
  - `publicCode: v.number()` on tournaments, conventions, and users,
    allocated from per-entity `appCounters` by `nextPublicCode`
    (`model/publicCodes.ts`). Tournaments and conventions start at 100001;
    users at 1.
  - `parsePublicCode` accepts any positive integer, so `/tournaments/100001`,
    `/tournaments/100002`, … walks every event. Unlisted is meant to be
    "reachable by link/code only" (`validators.ts:78`); sequential codes make
    that a formality.
  - `pairing.ts:255` falls back to `publicCode` as the shuffle seed for rows
    without `seed`. `createTournament` has set a seed since the field
    existed, so the fallback only serves pre-seed rows.
  - The user's numeric `publicCode` feeds `tiebreakRandom` (`model/random.ts`)
    and seeded test players (TODO.md:77). This plan leaves it alone.
  - 68 backend references outside `_generated` and specs, 41 web and native
    files. The routes already take strings and most consumers already call
    `String(publicCode)`. `conventions.convex.spec.ts`,
    `rateLimits.convex.spec.ts`, and `tournaments.convex.spec.ts` assert on
    the sequential values. `e2e/invite-links.spec.ts:32` reads the code off
    the manager URL, so it doesn't care.
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
- **What the invite gates:**
  - Only private events. `registerSelf` checks it only when
    `visibility === "private"` (`registrations.ts:162-169`), and
    `getPublicTournament` only when `isPubliclyViewable` is false
    (`lifecycle.ts:151-153`). On a public or unlisted event the code grants
    nothing.
  - It is still the only short URL for any event, so today it gets printed
    for public events too. If the event later goes private, those posters
    still let people in. PR 0 removes the reason to print it.
  - `InviteLinkCard` (`settings/invite-link-card.tsx`) renders for every
    visibility, with a description that only makes sense for a private
    event.
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

## PR 0: random public codes

Backend, plus the web and native call sites that assume a number.
Pre-production, so no migration: reset the DB.

1. **Tournaments and conventions get a random 6-character public code**,
   Crockford base32, about 30 bits.
   - `publicCode: v.string()` on both tables. `by_publicCode` stays.
   - Mint through a uniqueness check on `by_publicCode`, the same shape as
     `mintUniqueInviteCode`, retrying on collision.
   - Users keep their numeric `publicCode`: `/users/$publicCode`,
     `tiebreakRandom`, and seeded test players depend on it.
   - Delete `nextTournamentPublicCode`, `nextConventionPublicCode`, and their
     `appCounters` keys. `nextPublicCode` stays for users.
2. **One alphabet, one normalizer.** Move `INVITE_CODE_ALPHABET` and the
   lookalike rule out of `model/invites.ts` into `model/codes.ts`, shared by
   both kinds: `normalizeCode(value, length)` returns the canonical form or
   null. `normalizeInviteCode` becomes the 10-character case;
   `parsePublicCode` becomes the 6-character case and returns a string. The
   alphabet has no I, L, O, or U, so a 6-character code reads aloud as well
   as the invite code does today.
3. **Make `seed` required** on tournaments and drop the `publicCode` fallback
   at `pairing.ts:255`. It only served pre-seed rows, which the reset
   removes.
4. **Call sites.** Routes already take strings. Remove the `String(...)`
   wrappers on tournament and convention codes (`checkout.ts:216, 357`,
   `invites.ts:50`, `tournament-public-page.tsx:158-346`). Keep the ones on
   `user.publicCode` (`checkout.ts:179`, `registrations.ts:239`,
   `profile-privacy-card.tsx:109`).
5. **`/join/<code>` resolves both kinds.** Rename `resolveInviteCode` to
   `resolveJoinCode`. It normalizes the raw text as a 6-character code, then
   as a 10-character code:
   - 6 characters: look the tournament up by `publicCode`. Return
     `{ publicCode }` when it exists, is past `setup`, and the caller could
     open the event page, else null. "Could open the page" is
     `canViewTournament` (`model/tournaments.ts`), the rule moved out of
     `getPublicTournament` so both apply it: published public and unlisted
     events for anyone, private ones for registered players and the
     organizing team. Returning `{ publicCode }` for every published event
     would let anyone test whether a private event holds a given code, since
     the page itself answers null.
   - 10 characters: today's invite lookup. Return `{ publicCode, inviteCode }`.
   - Anything else: null. All three nulls are identical, so a bad code says
     nothing about which kind it was.
   - Rename `join.$inviteCode.tsx` to `join.$code.tsx`. It forwards to
     `/tournaments/<publicCode>`, adding `?invite=` only when the resolver
     returned one. Its empty state becomes "Code not found", since the route
     no longer knows it was handed an invite.
6. **Specs.** Move `conventions.convex.spec.ts`, `rateLimits.convex.spec.ts`,
   and `tournaments.convex.spec.ts` off the 100001-style values onto shape
   assertions (6 characters of the alphabet, unique across a batch). Add:
   the shared normalizer table (both lengths, lookalikes, separators),
   `resolveJoinCode` for each branch above, and `getPublicTournament` for an
   unknown code. Test collisions deterministically, since random draws
   almost never collide: `mintUniqueCode` with a stubbed "taken" check (taken
   once, then free; taken five times, then the error), and
   `mintUniquePublicCode` against each table with `crypto.getRandomValues`
   stubbed so the first draw is a code the table already holds.
7. **Docs.** `docs/` and CONTEXT.md references to numeric codes, and the
   `validators.ts:78` comment, which becomes true.

## PR 1: organizer QR on web

Depends on PR 0. No backend changes of its own.

1. Add `qrcode.react` to `apps/web`.
   - Import it explicitly. `nodeLinker: hoisted` exposes a stray transitive
     `qrcode`, so never write `from 'qrcode'`.
   - `check:deps` must still pass.
2. Add `components/shared/qr-code.tsx`, a thin wrapper around `QRCodeSVG`:
   - Fixed dark-on-white whatever the theme, `marginSize={4}`, `level="M"`,
     and a `title`.
   - No download helpers in the wrapper.
3. Add a `JoinQrDialog`:
   - **Data, by visibility:**
     - Public and unlisted: the code is `tournament.publicCode`, already on
       the managed tournament. No query, no row to create.
     - Private: it reads `getInviteLink`. When that returns null, it shows
       "Create invite link", which calls `regenerateInviteLink` (a plain
       create when no row exists). It never calls regenerate when a link
       already exists. `ensureInviteLink` isn't needed; the only case it
       would close is a race between two tabs.
     - Visibility is a live query, so flipping the event to private while
       the dialog is open swaps the QR code to the invite (or to "Create
       invite link").
   - **Lifecycle:** the QR code renders only while the event is in
     `registration`.
     - In `setup`: no QR code, only "Publish the event to get a QR code". A
       poster printed before publishing scans as "Code not found", which
       looks broken.
     - After registration closes (`in_progress`, `completed`, `cancelled`):
       no QR code, only "Registration is closed, so there's nothing to
       scan". `registerSelf` refuses every lifecycle but `registration`, so
       a code printed now would scan to a closed page. The entry points
       below stay visible and open this note, matching how `InviteLinkCard`
       already disables its actions on a cancelled event.
   - **Contents:** the QR code, the event name, the code for typing in by
     hand, and the URL. A public code is 6 characters and prints as is. An
     invite code prints as `XXXXX-XXXXX` (a local `formatInviteCode`, with a
     dash after 5 characters).
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
     - Public and unlisted events: "Making the event private stops this code
       from admitting anyone." There is nothing to rotate, so no rotation
       warning.
   - **Actions:**
     - Download PNG: a hidden `QRCodeCanvas` at about 1024px, saved with
       `canvas.toBlob`.
     - Print: a `@media print` stylesheet with the QR code, event name, and
       code only. Print preview also works as a full-screen venue display.
     - Present mode and SVG download are cut from v1. Add them if someone
       asks.
4. Entry points:
   - Turn `InviteLinkCard` into a share card that follows visibility.
     - Public and unlisted: the `/join/<publicCode>` URL with Copy and "Show
       QR code", and a note that going private is how you revoke it.
     - Private: today's invite link with Copy, Regenerate, Disable, and "Show
       QR code". Its current description stays, since it now only appears
       where it is true.
   - "QR code" next to "View public page" on the organizer Overview
     (`tournament-overview-view.tsx:73-83`).
5. Regenerate and Disable each get an `AlertDialog` saying that shared links
   and printed QR codes will stop working. Rotation is the only way to revoke
   an invite, so this is a must, not polish.
6. Extend `e2e/invite-links.spec.ts`:
   - The dialog opens, the rendered URL matches the share card's link, and
     the SVG is present. One run on a public event (`/join/<publicCode>`),
     one on a private event (the invite link).
   - A public event's join URL, opened after the event goes private, lands
     on not found.
   - Setup-stage events show no QR code, and neither do events whose
     registration has closed.
   - The Regenerate and Disable confirmations.
   - Make `e2e/README.md` match what the spec covers.

## PR 2a: native join screen (free and approval mode)

Everything here is reachable through simulator deep links. No native module
is installed, so no dev-client rebuild and no device. The scanner (PR 2b)
and the web-to-app bridge (PR 2c) build on it separately, so a reviewer
never sees a pure-function refactor mixed with a native module install.

**As built**, beyond the steps below:

- Native never calls `useQuery` itself, so core gained the hooks the screen
  needs: `useJoinCode` (the `resolveJoinCode` ladder, with the access hook's
  rule that a null answer for a signed-in viewer waits for Convex auth),
  `useMyEntryOrder`, `useFeePreview`, `useRegisterSelf`,
  `useCancelMyRegistration`, and `badgeGateFor`. The web's
  `RegistrationPanel` still computes its own badge gate; PR 3 moves it onto
  `badgeGateFor`.
- The web hand-off needs an origin, so native reads an optional
  `EXPO_PUBLIC_WEB_ORIGIN` (`lib/web-links.ts`). Unset, the "Pay on the web"
  and convention buttons are left out. The hand-off opens
  `/tournaments/<publicCode>?invite=<code>`, which is where the web's
  `/join` forwards.
- The root layout sets `unstable_settings.anchor = "index"`, so a deep link
  opens with home beneath it and a back arrow.
- Buttons use the web's labels ("Register for this event", "Request to
  register") rather than "Join", per Decisions.
- A pending entry whose order is payable after registration has closed
  derives `closed`. The web shows the payment badge with its closed note;
  there is nothing left to do either way.
- `@paper-pairings/shared/app-links` keeps its own copy of the two code
  lengths, since shared can't import the backend;
  `joinCodes.convex.spec.ts` pins that they match.

1. **Rename `tournament/[code]` to `tournaments/[code]`** so the native path
   matches the web.
   - Update the `router.push` at `index.tsx:89-92` and the `Stack.Screen`
     name in `_layout.tsx`.
   - Pre-production, so no compatibility shim. This removes the need for a
     `+native-intent.tsx` rewrite in PR 5.
2. **Add `@paper-pairings/shared/app-links`.**
   - `parseAppLink(raw)` returns `{ kind: 'join', code } | null`. It doesn't
     say which kind of code it found; `resolveJoinCode` does.
   - It accepts `…/join/<code>` on any host, `paperpairings://join/<code>`,
     and a bare code (6 or 10 alphanumerics after stripping spaces and
     dashes).
   - The server's normalizer (`model/codes.ts`, PR 0) stays the only
     authority on the code. The code helpers don't move into shared.
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
     order (`getMyEntryOrder`, undefined while loading), the badge gate,
     `badgeCompsThisEvent` (getPublicTournament's
     `convention.myBadgeCompsThisEvent`), and spots left.
   - The order is what separates a pending application from a pending entry
     that owes payment: both have `entryStatus: 'pending'`. On a paid event,
     pending with a `requires_payment` or `awaiting_payment` order is
     `completePayment`, whether the order is `post_approval` or the player's
     own unfinished direct checkout (`tournament-public-page.tsx:514-531`).
     Pending with the order still loading is `loading`, never
     `pendingReview`, so an approved player doesn't see "pending approval"
     flash before "Complete payment".
   - Outputs: `loading | signIn | register | requestToRegister | pay |
completePayment | pendingReview | waitlisted | registered | rejected |
full | closed | badgeBlocked`.
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
     - `resolveJoinCode`, which yields the public code and, for an invite,
       the invite code
     - `getPublicTournament` with the invite code when there is one
     - the registration row from the updated access hook
     - `getMyEntryOrder`, with `now` from the shared clock hook (step 7) and
       held across ticks with `useStableQuery`
     - `getFeePreview` (`payments/queries.ts:23`) for the "Pay $X" label
     - spots left
   - **Screen:** the event summary (name, date, venue, fee, spots left, and
     an approval-mode note) and the button from `deriveJoinAction`:
     - Signed out: the existing `SignInButton` modal. The route params
       survive the modal.
     - Join (including comped): `registerSelf`, then
       `router.replace('/tournaments/<publicCode>')`.
     - Request to join: `registerSelf`, then a live "Registration pending
       organizer approval" state (the web's copy, see Decisions) with
       Withdraw (`cancelMyRegistration`).
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
     - Unknown, disabled, or setup-stage code, or a public code whose event
       has since gone private: "Code not found". The same copy for both
       kinds, so the screen never says which kind a bad code was.
6. **Fix the `notRegistered` dead end on `tournaments/[code]`:** render the
   same join panel there, without an invite code, using the registration row
   the hook now exposes.
7. **Shared clock and query hooks** (moved here from PR 4, because
   `getMyEntryOrder` needs `now` and the join screen needs the order):
   - Move `useStableQuery` to `@paper-pairings/core` unchanged. It uses only
     `convex/react` and a ref; nothing in it is browser-specific.
   - Move `roundedClock`, `CLIENT_CLOCK_RESOLUTION_MS`, and the
     bucket-boundary scheduling of `useClientClock` into core, with the
     wake-up source injected as `subscribeToWake(refresh) => unsubscribe`.
     The web wrapper passes `visibilitychange` + window focus; the native
     wrapper passes `AppState` 'change' → 'active'. One copy of the rounding
     rule (`round: 'up'` matters for the refund verdict), two thin platform
     wrappers. The two hook tests move with them.

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
   - **Camera lifecycle:** pushing the join screen leaves `scan.tsx` mounted
     underneath, and a mounted `CameraView` keeps the camera session (and
     the torch) running. Render `CameraView` only while the screen is
     focused (`useIsFocused`) and the app is active (`AppState`), as Expo's
     camera docs require, and turn the torch off on blur.
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
- **The "pending, paid, order not payable" state is no longer stored.**
  Both clients say "Registration pending organizer approval" for a pending
  row on a paid event whose order is neither payable nor loading
  (`deriveJoinAction`'s pending fall-through; `tournament-public-page.tsx`
  RegistrationPanel). It used to be reachable through the normal start
  path: `startTournament` and `cancelTournament` schedule
  `closeOpenOrdersSweep`, which moved an unfinished checkout's order to
  `canceled` but left its registration row `pending`. Only the webhook's
  `closeUnpaidSession` withdrew the row, and it returns early once the
  order is no longer `awaiting_payment`. The player then saw "pending
  organizer approval" plus the closed note on an event that had started,
  the row stayed in `listMyTournaments` as an open application, and it was
  never in the Review Queue (`awaitingReview` is unset on direct rows and
  cleared by approval), so the organizer never saw it either.
  - Fixed on the backend: the sweep now withdraws the pending entry behind
    every order it closes, direct or post-approval, since registration is
    over for both, and logs `payment_expired` for a session it expires the
    way the webhook handler does. `paymentsSweeps.convex.spec.ts` ("starting
    a paid tournament lapses open checkouts") pins the row and the audit
    line.
  - The client fall-through stays as a defensive default. If PR 3's
    characterization pass wants it pinned, `getMyRegistration` returns the
    raw row, so `PlayerRegistration` carries `awaitingReview`: a pending row
    without it is never under review and can derive `closed` instead of
    `pendingReview`.

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
3. **Shared hooks:** already in core since PR 2a (step 7 there).
4. **Payment-status dispatch:** pull the status dispatch out of
   `apps/web/src/components/shared/payment-return.tsx` into core, so native
   shows the same outcomes.
   - Give it a `returnHint: 'success' | 'cancelled' | 'dismissed' | null`
     input. The order is `awaiting_payment` from the moment the Checkout
     session is attached (`checkout.ts:394`), before anyone pays, and the web
     dispatch shows "Confirming your payment" for that status with no way
     out (`payment-return.tsx:138`). On the web that is fine, because only
     Stripe's success redirect reaches the payment page. Native reaches it
     after a cancel or a closed browser too.
   - With `cancelled` or `dismissed`, `awaiting_payment` renders "Payment
     not finished" with "Try again" (a fresh `createEntryCheckout`, which
     supersedes the old session) and "Back to the event", instead of the
     spinner. The order stays authoritative: if the webhook lands anyway
     (the player paid, then closed the browser before the redirect), the
     card flips to `paid` like any other.
5. **Native flow:**
   - Split `tournaments/[code].tsx` into `tournaments/[code]/index.tsx` and
     `tournaments/[code]/payment.tsx`.
   - Pay and Complete payment call
     `createEntryCheckout({ ..., returnTo: 'app' })`, then
     `WebBrowser.openBrowserAsync(url)`.
   - A `Linking` 'url' listener catches `paperpairings://…/payment`, calls
     `WebBrowser.dismissBrowser()`, and navigates to the payment screen with
     the hint the URL carries (`success` or `cancelled`, see step 6).
   - Closing the browser by hand lands on the payment screen with
     `dismissed`. Detecting it differs by platform:
     - iOS: `openBrowserAsync` resolves with `cancel` when the player closes
       the browser (and `dismiss` after our own `dismissBrowser()` call,
       which the deep link has already handled).
     - Android: `openBrowserAsync` resolves with `opened` as soon as the
       Custom Tab launches (`WebBrowserModule.kt`), so the promise says
       nothing about closing. Set an "in checkout" ref when opening, and on
       `AppState` → 'active' with the ref set, clear it and go to the
       payment screen with `dismissed`. A deep link arriving around the same
       time replaces that with its own hint (`router.replace`, so the screen
       never stacks twice). Clear the ref and the listener when the screen
       unmounts.
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
   - Cancelling returns the same way, with `cancelled=1` on Stripe's
     `cancel_url` and on the deep link, so the app shows "Payment not
     finished" rather than waiting on a payment that never started.
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

- **A public code is an identifier, not a secret.** Random codes stop anyone
  counting from one event to the next, which sequential codes allowed. They
  don't stop random guessing: with N unlisted events, a guess finds one about
  once in 2³⁰ / N tries, and `resolveJoinCode` and `getPublicTournament` are
  queries, which can't be rate-limited (queries can't write;
  `docs/rate-limiting.md:55`). So unlisted means obscure, not protected. An organizer who needs to revoke
  access goes private and hands out the invite. Keep the invite at 10
  characters for the same reason; don't shorten it to match.
- **The poster is the exposure, not guessing.**
  - The invite code is a bearer secret printed with no expiry.
  - At 50 bits, guessing is moot.
  - Rotation is the only way to revoke an invite, and it kills every private
    poster at once. Hence the PR 1 confirmations and trust copy.
  - A public or unlisted poster is revoked by going private. It then reads
    as not found, the same as an unknown code.
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
  - Add a "Public Code" entry: the event's stable, random, 6-character
    identifier in every URL; never a secret, never rotated; an unlisted event
    is reachable by it and nothing else. _Avoid_: tournament id (the Convex
    document id, which never reaches a URL).
  - Add a "Join QR" entry: the QR form of the event's join URL. Public and
    unlisted events encode the Public Code; private events encode the Invite
    Link. No QR code during setup. Going private revokes a public poster;
    rotating revokes a private one.
  - Add an "Approval Mode" entry: the `registrationRequiresApproval`
    admission mode, where `registerSelf` files a pending application and the
    Review Queue decides it. No _Avoid_ line.
  - Add "Waiting Room" only if the term reaches UI copy: the player-side
    name for the Review Queue, with the two edges from Decisions settled.
- **TODO.md:**
  - PR 0 goes under §3 (admission), next to the visibility item
    (TODO.md:307).
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
  - core: `deriveJoinAction` (including approval × full, the comped rows,
    pending with a payable order of each purpose, and pending with the
    order loading), the updated `player-access`, the PR 3 characterization
    rows for `RegistrationPanel`, the payment dispatch (each status × each
    return hint), and the moved `useClientClock` / `useStableQuery` tests
  - backend: the shared normalizer, public code shape and uniqueness,
    deterministic code collisions, `resolveJoinCode`, the three specs moved
    off sequential values,
    `checkoutReturnUrls` (tournament and convention paths), `returnTo`
    threading, and badge checkout URLs unchanged
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
    on a paid event, a badge-gated child event, a public code, an unlisted
    event's public code, a public code after the event went private, a
    private event's invite, disabled or rotated invite, setup-stage code of
    either kind, signed out then sign in, event full, approval mode while
    full, already registered.
- **Physical devices only** (expo-camera is device-only), for PR 2b and PR
  4, on an iPhone and an Android phone:
  - the scanner: lock and re-arm, a QR code from somewhere else, torch,
    and the camera (and torch) going off once the join screen is pushed
  - camera permission denied, then allowed through Settings
  - haptics
  - the PR 4 payment round trip, including the Android Custom Tab
    back-stack check, and closing Checkout without paying on each platform
    (by hand and through Stripe's cancel link)
- Use the `verify` skill for the web organizer flow.

## Later QR uses this sets up

The scanner routes through `parseAppLink`'s union, and `QrCode` is generic.
That leaves room for:

- player check-in or ID badges, which need `react-native-qrcode-svg`
- QR codes on printed result slips (TODO §8)
- convention invite links (TODO §4)
