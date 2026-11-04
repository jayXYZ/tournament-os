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

| Work                                   | Implementation and merge evidence                                                                                                                                                                                                                                                                                                                                                                                                            | Deployment verification                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing invite links                  | On `main`, PR #18, `b795666`. Private-event invite grant, join redirect, regeneration and disabling.                                                                                                                                                                                                                                                                                                                                         | Backend specs and browser join coverage exist; no current-release deployment result recorded.                                                                                                                                                                                                                                                                                                                                                                                |
| Random event codes and web QR sharing  | Implemented on `feat/qr-codes` (rebased onto `main`; branch head `e28abf1` plus council-review fixes), to be merged with that branch's PR — cite the PR and merge SHA when it lands. Random six-character event codes, one `/join/<code>` resolver for public codes and invite grants, and the organizer's QR dialog with download and print. `joinCodes.convex.spec.ts`, `inviteLinks.convex.spec.ts`, and the `invite-links` browser spec. | No deployment result recorded. Verify public, unlisted, private, rotated/disabled, and changed-visibility links against the release candidate. The personal dev DB was reset on 2026-11-04 for the string `publicCode` and required `seed`.                                                                                                                                                                                                                                  |
| Native free/approval join              | Implemented on `feat/qr-codes` (same PR): the `/join/<code>` screen, shared join-state hooks in `@paper-pairings/core`, withdrawal, and the web payment handoff behind `EXPO_PUBLIC_WEB_ORIGIN`.                                                                                                                                                                                                                                             | iOS simulator only: the PR 2a deep-link matrix passed on 2026-11-04 at `2b3d36a` (`qr/verify-join`) against the personal dev deployment; see the record below. No Android or physical-device result; verify on physical iOS and Android. The web panel on the shared derivation is built on `qr/web-panel-derivation` (not merged; see the 2026-11-04 web panel record below). Scanner, native payment return, and universal links remain planned (`docs/plans/qr-join.md`). |
| Organizer guest/email enrollment       | Merged in PR #50 at `7673dac`, with the follow-up fix `1d4423b`. Add-guest and enroll-by-email flows, event-local names, claim on sign-in and app open, checkout takeover of an enrolled seat, with backend specs, web dialog tests, and the `enrollment-claim` browser spec.                                                                                                                                                                | No deployment result recorded. Verify enrollment, claim at sign-in, and the checkout takeover of an enrolled seat against the release candidate.                                                                                                                                                                                                                                                                                                                             |
| Web design foundation                  | Merged PR #32, `8ca7c9d`; PR #33, `89050e3`; PR #34, `4cb170d`. Theme/branding, Overview, layout, table controls, and component styling.                                                                                                                                                                                                                                                                                                     | Figma completion and source code establish design/implementation status. Full accessibility and responsive deployment audits remain open.                                                                                                                                                                                                                                                                                                                                    |
| Convention ticket types and door sales | Merged with PR #23, `1411825`; ADR 0004 and `conventions/ticketTypes.ts`. Registration spans the live convention until complete/cancel.                                                                                                                                                                                                                                                                                                      | Specs exist; no current-release badge Checkout or door-sale deployment result recorded.                                                                                                                                                                                                                                                                                                                                                                                      |
| Payments and recovery                  | Payment foundation in PR #20; Connect updates in PR #30, `2fe531a`; refund recovery in PR #40, `9c0798a`; unpaid-entry sweep fix in PR #42, `721911e`.                                                                                                                                                                                                                                                                                       | Historical sandbox exercise below. Current-release sandbox and live-mode readiness remain open.                                                                                                                                                                                                                                                                                                                                                                              |
| Monitoring                             | Web browser/SSR and native Sentry wiring is on `main`. Convex reporting is configured per deployment outside the codebase.                                                                                                                                                                                                                                                                                                                   | A setup-script run for projects/DSNs was previously reported. Receipt of test events and source-map readability are not recorded. Convex Pro was the recorded backend-integration blocker; current account state was not inspected.                                                                                                                                                                                                                                          |
| Deployment tooling and CI              | `apps/web/vercel.json`, web-build CI added at `00b1ef5`, and `srvx` start script at `7fc16a3` are on `main`.                                                                                                                                                                                                                                                                                                                                 | A CI build without runtime credentials is not a deployment smoke test. Vercel configuration, deployed auth/data flows, and custom domain remain unverified here.                                                                                                                                                                                                                                                                                                             |

The QR plan is `docs/plans/qr-join.md`. Its PR 0, PR 1, PR 2a, and PR 3
stage labels mean built work; they are not GitHub PR numbers or merge
evidence, and PR 2b, PR 2c, PR 4, and PR 5 are planned. The plan's "Current state" section predates the
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
