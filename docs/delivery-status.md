# Delivery status and verification

Audit date: 2026-10-28. Code baseline: `main` and freshly fetched
`origin/main` at `7fc16a3`. This is a repository and history audit; no
deployment, provider dashboard, or physical device was exercised in this pass.
The app remains pre-production.

## Status rules

- Implemented means code exists at a named branch/revision. It may still need
  review, integration, or verification.
- Merged means the implementation is in `main`. A merge does not prove that
  the target deployment contains it or has the required configuration.
- Verified in deployment means a named workflow ran against an identified
  deployment/build and revision, with a date and recorded result. Sandbox,
  preview, live mode, browser, and native device results have separate scopes.

Use these distinctions in [the roadmap](../TODO.md). Keep branch-only work
unchecked there until merged. A historical verification record is evidence for
that exercise only. If the target or revision is missing, retain the record
and say what is unknown rather than treating it as a release check.

## Audited delivery state

| Work                                   | Implementation and merge evidence                                                                                                                                                                                                                                                                                                                                                                                                                           | Deployment verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing invite links                  | On `main`, PR #18, `b795666`. Private-event invite grant, join redirect, regeneration and disabling.                                                                                                                                                                                                                                                                                                                                                        | Backend specs and browser join coverage exist; no current-release deployment result recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Random event codes and web QR sharing  | Implemented on `feat/qr-codes` (rebased onto `main`; branch head `cd1be4e`, which includes the council-review fixes), to be merged with that branch's PR — cite the PR and merge SHA when it lands. Random six-character event codes, one `/join/<code>` resolver for public codes and invite grants, and the organizer's QR dialog with download and print. `joinCodes.convex.spec.ts`, `inviteLinks.convex.spec.ts`, and the `invite-links` browser spec. | No deployment result recorded. Verify public, unlisted, private, rotated/disabled, and changed-visibility links against the release candidate. The personal dev DB was reset on 2026-11-04 for the string `publicCode` and required `seed`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Native free/approval join              | Implemented on `feat/qr-codes` (same PR): the `/join/<code>` screen, shared join-state hooks in `@paper-pairings/core`, withdrawal, and the web payment handoff behind `EXPO_PUBLIC_WEB_ORIGIN`.                                                                                                                                                                                                                                                            | iOS simulator only: the PR 2a deep-link matrix passed on 2026-11-04 at `2b3d36a` (`qr/verify-join`) against the personal dev deployment; see the record below. No Android or physical-device result; verify on physical iOS and Android. The web panel on the shared derivation is built on `qr/web-panel-derivation` (not merged; see the 2026-11-04 web panel record below). The QR scanner is built on `qr/native-scanner` (not merged), simulator only: its camera, torch, haptics, and scan lock have no device result (see the 2026-11-04 scanner record below). Native payment return and universal links remain planned (`docs/plans/qr-join.md`). |
| Organizer guest/email enrollment       | Merged in PR #50 at `7673dac`, with the follow-up fix `1d4423b`. Add-guest and enroll-by-email flows, event-local names, claim on sign-in and app open, checkout takeover of an enrolled seat, with backend specs, web dialog tests, and the `enrollment-claim` browser spec.                                                                                                                                                                               | No deployment result recorded. Verify enrollment, claim at sign-in, and the checkout takeover of an enrolled seat against the release candidate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Web design foundation                  | Merged PR #32, `8ca7c9d`; PR #33, `89050e3`; PR #34, `4cb170d`. Theme/branding, Overview, layout, table controls, and component styling.                                                                                                                                                                                                                                                                                                                    | Figma completion and source code establish design/implementation status. Full accessibility and responsive deployment audits remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Convention ticket types and door sales | Merged with PR #23, `1411825`; ADR 0004 and `conventions/ticketTypes.ts`. Registration spans the live convention until complete/cancel.                                                                                                                                                                                                                                                                                                                     | Specs exist; no current-release badge Checkout or door-sale deployment result recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Payments and recovery                  | Payment foundation in PR #20; Connect updates in PR #30, `2fe531a`; refund recovery in PR #40, `9c0798a`; unpaid-entry sweep fix in PR #42, `721911e`.                                                                                                                                                                                                                                                                                                      | Historical sandbox exercise below. Current-release sandbox and live-mode readiness remain open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Monitoring                             | Web browser/SSR and native Sentry wiring is on `main`. Convex reporting is configured per deployment outside the codebase.                                                                                                                                                                                                                                                                                                                                  | A setup-script run for projects/DSNs was previously reported. Receipt of test events and source-map readability are not recorded. Convex Pro was the recorded backend-integration blocker; current account state was not inspected.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Deployment tooling and CI              | `apps/web/vercel.json`, web-build CI added at `00b1ef5`, and `srvx` start script at `7fc16a3` are on `main`.                                                                                                                                                                                                                                                                                                                                                | A CI build without runtime credentials is not a deployment smoke test. Vercel configuration, deployed auth/data flows, and custom domain remain unverified here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The QR plan is `docs/plans/qr-join.md`. Its PR 0, PR 1, PR 2a, PR 2b, and
PR 3 stage labels mean built work; they are not GitHub PR numbers or merge
evidence, and PR 2c, PR 4, and PR 5 are planned. The plan's "Current state" section predates the
implementation; prefer the code and the plan's "As built" notes when
reconciling it.

## Historical verification record

On 2026-10-04, the roadmap recorded a Stripe sandbox exercise covering hosted
Connect onboarding, thin-event account status sync, webhook-fulfilled paid
tournament registrations, a player-cancel full refund with organizer-absorbed
fees, and a completion sweep with two charge-anchored transfers. The exercise
found account-creation and restricted-key permission issues that were fixed.

The record does not include a deployment URL/name, tested SHA, or provider
event references. It predates the October refund recovery and sweep fixes and
does not establish convention ticket coverage, native Checkout, or live-mode
readiness. Retain it as historical evidence and repeat the relevant cases for
the release candidate. See [payments](payments.md) and the
[refund recovery runbook](refund-recovery.md).

## Native join on the iOS simulator, 2026-11-04

Scope: the PR 2a "Simulator deep links" matrix of `docs/plans/qr-join.md`,
run as the Maestro flows in `apps/native/e2e/` (see the native README,
"Device E2E (Maestro)"). This is a personal development environment, not a
release candidate, and it says nothing about Android or physical devices.

- Tested SHA: `2b3d36a` on `qr/verify-join`, stacked on `feat/qr-codes` at
  `cd1be4e`; not merged. Backend functions were pushed from that tree.
- Backend: Convex development deployment `dev:perceptive-guanaco-394`, Clerk
  development instance. Payments: none. Paid events used the dev-only
  stand-in Stripe account (`devSeed:markOrganizationPayoutsReady`); no Stripe
  call was made and nothing was paid.
- Build: Expo dev client, Debug configuration from `expo run:ios`
  (`com.paperpairings.app` 0.1.0, build 1; Expo SDK 56.0.23, React Native
  0.85.3, expo-dev-client 56.0.27), Xcode 27.0 (27A266a). JS from Metro with
  a cleared cache at the tested SHA.
- Device: iPhone 17 Pro simulator, iOS 26.5. Maestro 2.12.1 (Temurin JDK
  17.0.21). Signed in as the runner's Clerk test user through the dev-only
  ticket link, not AuthView.
- Runs: every flow with `EXPO_PUBLIC_WEB_ORIGIN` unset, 17/17 passed in
  8m44s (seed run `62f2009a`). Flows 03 to 06 again with
  `EXPO_PUBLIC_WEB_ORIGIN=http://localhost:3000`, 4/4 passed (seed run
  `9dba7445`). Each run seeds its own organization, `E2E Native Join <run>`.

| Scenario                         | Flow                         | Expected                                                                                                           | Observed                                                                            |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Free event                       | `01-free`                    | "Register for this event", Entry "Free", "8 spots left"                                                            | Pass                                                                                |
| Approval event                   | `02-approval`                | "Request to register"; tapped, "Registration pending organizer approval"; withdrawn, back to "Request to register" | Pass; both toasts shown                                                             |
| Paid event, web origin unset     | `03-paid`                    | Entry "<total> ($15.00 entry + <fees> fees)"; "Paying isn’t available in the app yet. Finish on the web."          | Pass; a hierarchy probe of the same setup read "$16.53 ($15.00 entry + $1.53 fees)" |
| Paid event, web origin set       | `03-paid`                    | "Pay <total> on the web", "You’ll sign in again on the web to pay."                                                | Pass; probe read "Pay $16.53 on the web"                                            |
| Paid event with approval         | `04-paid-approval`           | "Request to register", "8 spots left · <total> due after approval"                                                 | Pass; probe read "$16.53 due after approval"                                        |
| Comped badge holder, paid event  | `05-comped`                  | "Register for this event", "8 spots left · included with your convention badge", no payment copy                   | Pass                                                                                |
| Badge-gated child event          | `06-badge-gated`             | "This event requires a confirmed E2E Badge Convention badge — register for the convention first."                  | Pass                                                                                |
| Public code (typed in lowercase) | `07-public-code-typed`       | Resolves; "Register for this event"                                                                                | Pass                                                                                |
| Unlisted event's public code     | `08-unlisted`                | "Register for this event"                                                                                          | Pass                                                                                |
| Public code after going private  | `09-went-private`            | "Code not found"                                                                                                   | Pass                                                                                |
| Private event                    | `10-private-invite`          | Public code "Code not found"; invite "Register for this event"                                                     | Pass                                                                                |
| Rotated invite                   | `11-rotated-invite`          | Old code "Code not found"; new code "Register for this event"                                                      | Pass                                                                                |
| Disabled invite                  | `12-disabled-invite`         | "Code not found"                                                                                                   | Pass                                                                                |
| Setup-stage codes                | `13-setup-codes`             | Public code and invite both "Code not found"                                                                       | Pass                                                                                |
| Signed out, then sign in         | `14-signed-out-then-sign-in` | "Sign in to register"; after sign-in on that screen, "Register for this event"                                     | Pass                                                                                |
| Event full                       | `15-full`                    | "Tournament is full", "2 of 2 registered"                                                                          | Pass                                                                                |
| Approval mode while full         | `16-approval-full`           | "Tournament is full", no "Request to register"                                                                     | Pass                                                                                |
| Already registered               | `17-already-registered`      | "You’re registered", "Open the event"                                                                              | Pass                                                                                |

Found while setting up: the documented `pnpm --filter @paper-pairings/native ios`
build failed on Xcode 27 because pod targets declared deployment targets
below iOS 15; fixed in `311745f`. The first suite run had two failures in
the harness itself (a bundle reload racing the sign-in link), fixed before
the recorded runs. No defect was found in the join screen or the backend.

Not covered, and still open in [the roadmap](../TODO.md) section 8:

- Android: the machine had no Android SDK or emulator.
- Physical iPhone and Android devices: none were used.
- The QR scanner, camera permission, torch, and haptics (PR 2b, not built)
  and the Stripe payment round trip (PR 4); the pay hand-off button was
  asserted, not tapped.
- Google sign-in through AuthView; the ticket link stands in for it.
- Join states the matrix does not list: pending with a payable order,
  waitlisted, declined, closed, and a badge that does not cover the event's
  day. They remain covered only by `join-action.test.ts`.
- Taking a seat directly ("Register for this event") and "Open the event"
  were asserted, not tapped.
- The suite runs by hand; it is not in CI or EAS Workflows.

## Web registration panel on the shared derivation, 2026-11-04

Scope: PR 3 of `docs/plans/qr-join.md`, the web `RegistrationPanel` moved
onto `deriveRegistrationAction` in `@paper-pairings/core`, whose projection
`deriveJoinAction` also feeds the native join screen. This is a personal
development environment, not a release candidate.

- Tested SHA: `ed73394` on `qr/web-panel-derivation`, stacked on
  `qr/verify-join` at `9a6295c`; not merged. The branch changes no backend
  code; functions were pushed from that tree with `convex dev --once`.
- Backend: Convex development deployment `dev:perceptive-guanaco-394`, Clerk
  development instance. Payments: none. The web specs register for free
  events, and the native paid flows stop at the hand-off.
- Web: the Vite dev server started by the Playwright config, Playwright's
  Chromium, signed in through the Clerk ticket setup project.
- Native: the dev client build of the 2026-11-04 native record (Debug,
  `com.paperpairings.app` 0.1.0, build 1, Xcode 27.0 (27A266a)), JS from
  Metro with a cleared cache at the tested SHA. iPhone 17 Pro simulator, iOS
  26.5, Maestro 2.12.1. Signed in through the dev-only ticket link.

| Run                                                            | Result                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `invite-links.spec.ts` and `enrollment-claim.spec.ts` (web)    | 4/4 passed (auth setup plus 3 tests) in 55.7s                                            |
| Every Maestro flow, `EXPO_PUBLIC_WEB_ORIGIN` unset, first run  | 16/17 (seed run `d2a98dfe`); `05-comped` failed before its join screen opened, see below |
| `05-comped` alone                                              | Passed (seed run `a0b09a0c`)                                                             |
| Every Maestro flow, `EXPO_PUBLIC_WEB_ORIGIN` unset, second run | 17/17 passed in 8m32s (seed run `a5befe8a`)                                              |
| Flows 03 to 06, `EXPO_PUBLIC_WEB_ORIGIN=http://localhost:3000` | 4/4 passed in 1m50s (seed run `458bb750`)                                                |

The first run's `05-comped` failure was in the shared sign-in setup: after
the ticket link, home showed "We couldn't verify your account" (the auth
gate's unverified state) through the 60-second wait, so the flow never
reached the join screen. Its cause is not diagnosed. It did not recur in
the next 22 flow runs.

Not covered: in a browser, the panel's approval, paid, post-approval,
waitlisted, declined, dropped, disqualified, and eliminated states. They are
pinned only by the component characterization rows
(`apps/web/src/components/tournament-public-page.test.tsx`) and core's
`join-action.test.ts`. The other web specs (organizer happy path,
corrections, mid-round drop) were not run; they don't reach the panel.
Android and physical devices were not used.

## Native QR scanner on the iOS simulator, 2026-11-04

Scope: PR 2b of `docs/plans/qr-join.md`, the native scanner, run as four new
Maestro flows (18 to 21) beside the existing join matrix in
`apps/native/e2e/`. A simulator has no camera, so this covers the scanner's
entry points, permission states, and typed codes, and nothing that needs a
real QR code. This is a personal development environment, not a release
candidate.

- Tested SHA: `ba289b1` on `qr/native-scanner`, stacked on
  `qr/web-panel-derivation` at `b7eab32`; not merged. The branch changes no
  backend code; functions were pushed from that tree with
  `convex dev --once`.
- Backend: Convex development deployment `dev:perceptive-guanaco-394`, Clerk
  development instance. Payments: none; the paid flows stop at the
  hand-off.
- Build: a fresh dev client from `expo prebuild --clean --platform ios` and
  `expo run:ios`, Debug (`com.paperpairings.app` 0.1.0, build 1; Expo SDK
  56.0.23, React Native 0.85.3, expo-dev-client 56.0.27, expo-camera 56.0.8,
  expo-haptics 56.0.3), Xcode 27.0 (27A266a). The Podfile deployment floor
  still applied, and the generated Info.plist carries
  `NSCameraUsageDescription` and no `NSMicrophoneUsageDescription`. JS from
  Metro at the tested SHA; Metro was restarted with a cleared cache before
  the second full run.
- Device: iPhone 17 Pro simulator, iOS 26.5. Maestro 2.12.1 (Temurin JDK
  17.0.21). Signed in through the dev-only ticket link, as the runner's
  test player or, for the empty home, its new never-registered newcomer.
- Camera permission set per launch through Maestro's `launchApp`
  permissions: allowed unless a flow says `unset` or `deny`.

| Run (`EXPO_PUBLIC_WEB_ORIGIN` unset throughout) | Result                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every flow, first run                           | 20/21 (seed run `7fc36184`); `21-scan-typed` failed in its sign-in setup, see below         |
| `21-scan-typed` alone                           | Passed (seed run `17a4e86d`)                                                                |
| Every flow, second run, Metro cache cleared     | 20/21 (seed run `70ae4bfd`); `17-already-registered` failed in its sign-in setup, see below |
| `17-already-registered` alone                   | Passed (seed run `d2d5501c`)                                                                |
| Every flow, third run                           | 21/21 passed in 10m30s (seed run `ecb93452`)                                                |

| Scenario                            | Flow                  | Expected                                                                                                                                                                               | Observed                                         |
| ----------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Scanner from the home header        | `18-scan-from-header` | Camera allowed: "Point the camera at the event’s QR code", "Turn on flashlight", "Type a code instead"; Close returns home                                                             | Pass; the preview is black (no simulator camera) |
| Scanner from the empty home         | `19-scan-empty-state` | Newcomer's home: "No active tournaments" and "Scan a QR code to join"; it opens the scanner, Close returns to the empty home                                                           | Pass                                             |
| Camera not asked yet, then refused  | `20-scan-permission`  | Explainer "Scan an event’s QR code"; "Allow camera" raises the system prompt with the configured usage string; "Don’t Allow" turns it into "Camera access is off" with "Open Settings" | Pass                                             |
| Camera refused before launch        | `20-scan-permission`  | Straight to "Camera access is off", "To scan QR codes, turn on camera access for Paper Pairings in Settings.", "Open Settings", typing still offered                                   | Pass                                             |
| A link from elsewhere, typed        | `21-scan-typed`       | `https://example.com/menu/7KQ2MX`: "Not a Paper Pairings code", the scanner stays, the text stays for fixing                                                                           | Pass                                             |
| Public Code, typed in lowercase     | `21-scan-typed`       | The free event's join screen, "Register for this event"                                                                                                                                | Pass                                             |
| Back to the scanner, then an invite | `21-scan-typed`       | The join screen's "Scan" back arrow returns to a scanner that takes a code; the private event's invite typed as `XXXXX-XXXXX` opens its join screen                                    | Pass                                             |
| The 17 join-matrix flows            | `01` to `17`          | As in the 2026-11-04 native join record                                                                                                                                                | Pass                                             |

Found while building: with the scanner registered as a `fullScreenModal`,
the join screen it pushed came up as a page sheet with no back arrow,
because the native stack presents every screen pushed after a modal as a
modal. The scanner is a full-screen card that slides up instead (plan,
PR 2b "As built"). `expo install` through the pnpm filter re-resolved
unrelated lockfile peer suffixes; the committed lockfile is a root
`pnpm install`'s pure addition.

Both failures were the sign-in symptom the web panel record describes for
`05-comped`: after the ticket link, home showed "We couldn't verify your
account" through the 60-second wait, before the flow reached its first
assertion of its own. They hit different flows (one right after the
newcomer's flow, one not), 2 of the 65 flow runs in this record, and each
passed on its rerun. Not diagnosed; it is in the shared sign-in setup, not
the scanner.

Not covered, and still open in [the roadmap](../TODO.md) section 8:

- Anything needing a camera, so a physical device: scanning a real Join QR
  and a foreign QR code, the scan lock and its 1.5-second repeat window,
  re-arming after backing out, the camera and torch going off under the
  join screen and in the background, the torch itself (its button was
  asserted, not tapped: the dev client's tools button sits over it), the
  haptic, and granting access in Settings after a refusal ("Open Settings"
  was asserted, not tapped). The intake and lock rules are pinned by
  `packages/shared/src/scan-intake.test.ts`.
- Android: no SDK or emulator on the machine, so the Material Symbols scan
  icon and the Android permission flow are unverified.
- The suite runs by hand; it is not in CI or EAS Workflows.

## Review fixes on `qr/review-fixes`, 2026-11-05 and 2026-11-07

Not a release check: no simulator or device was exercised, and the browser
runs are the specs noted below, against the personal dev deployment.
`qr/review-fixes` stacks on `qr/native-scanner` at `146637d` (not
merged) and fixes the findings of a review of the QR join stack. The
derivation, join-route, scanner, dev-seed, and backend fixes are covered by
unit tests, component tests, or convex-test specs; the native navigation and
dev-session-link fixes rest on typecheck, lint, and the installed expo-router
source; the Maestro runner's deployment pin, issuer gate, and credential
scrub rest on `node --check`, lint, and throwaway scripts against the
installed Convex CLI and dotenv, not on a runner execution. `pnpm check`
passes on the branch. What changed that a device run should re-check:

- Join states: a pending entry owing payment whose badge now comps the event
  registers free, with Withdraw beside the button; a pending entry owing
  payment on a full direct-mode event (by the event's approval setting now,
  not the order's purpose) reads "Tournament is full" beside Withdraw; a
  hidden badge-gated parent still gates its public child without naming it.
- A signed-out viewer whose code or event page opens nothing is offered "Sign
  in to view this event" (web event page, web join route, native join
  screen). The Playwright invite-links spec's signed-out assertions were
  updated to it, and the spec passed (both tests plus the auth setup, 48 s)
  in Chromium against the personal dev deployment with the branch's backend
  pushed, at `907dd55`, 2026-11-05. The other browser specs were not run.
- Native navigation: "Open the event" from a join screen the scanner opened
  returns home first; a dev session link closes only its own screen and acts
  on every new ticket.
- Scanner: the repeat window remembers several recent codes and restarts
  when the camera is ready.
- The Maestro runner pins the Convex deployment over any deploy key, checks
  the Clerk issuer before seeding, and keeps credential-named variables out
  of Maestro and xcrun (the Convex CLI keeps only its own `CONVEX_*`
  variables). The dev seed refuses a live Stripe key.

A second review round, 2026-11-07, fixed ten more findings in one commit
after `ada3aac`. An eleventh — that the badge comp of an entry owing payment
checks capacity on an approval-mode event — was not a defect: the Checkout
webhook makes the same seat decision when a payment lands, so a full event
seats no one either way; the comments now say so. The core, web, and backend
fixes are covered by unit tests, component tests, or convex-test specs; the
native join view's clock change rests on typecheck and the shared clock's
tests; the runner's wider credential-name rule rests on `node --check` and a
throwaway script against sample names. `pnpm check` passes. What changed
that a device run should re-check:

- The web event page offers a viewer Convex could not verify the handshake
  restart and sign-out (the shell the `/join` route already showed) instead
  of "Tournament not found".
- A disqualified seat gets no "Cancel registration" button while registration
  is open, since the server refuses that cancel; eliminated and disqualified
  seats both read as locked there.
- An order held across the clock's ticks is dropped when the event changes
  under a mounted panel (a route updating its params in place), so one
  event's order never picks another's button while it loads.
- The native join view and the web order hooks keep the client clock still
  while the order query is skipped (a free event, a signed-out viewer), so
  those surfaces no longer re-render once a minute.
- The Maestro runner also scrubs names with `KEY` as an inner segment
  (`AWS_ACCESS_KEY_ID`), `PASSWD`, and a trailing `PAT` or `AUTH` segment. A
  credential inside a URL-valued variable is still not caught by name.
- Backend, no behavior change intended: the event page, the join URL, and the
  admin code lookup share one code-to-tournament helper; the child-event
  badge gate has one rule behind the mutation's refusal and the page's
  warning; the page reuses the viewer its access rule resolved.

The invite-links and enrollment-claim Playwright specs passed (four tests
with the auth setup, 53 s) in Chromium against the personal dev deployment
with this round's backend pushed, 2026-11-07. The other browser specs were
not run.

## Recording the next verification

For each deployment exercise, append a dated record with:

- Environment and URL or native build identifier, deployed SHA, and provider
  mode. For native, include OS/device and build profile.
- Scenario and expected outcome, including the refusal/retry cases that matter.
- Observed outcome and evidence, such as a CI run, Sentry issue, or sandbox
  event reference. Never record secrets, invite grants, or player details.
- Remaining failures, missing coverage, and the roadmap task they keep open.

For payments, verify both signed endpoints and the current refund recovery
paths. For monitoring, verify browser, SSR, native, and Convex separately,
including source locations. For Vercel, verify the deployed app's auth and
data flows in addition to build/start success. Configuration instructions
live in [environment](environment.md); having those instructions is not a
record that they were followed.
