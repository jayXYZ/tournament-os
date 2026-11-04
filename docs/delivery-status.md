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

| Work                                   | Implementation and merge evidence                                                                                                                                                                                                                                                                                                                                                                    | Deployment verification                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing invite links                  | On `main`, PR #18, `b795666`. Private-event invite grant, join redirect, regeneration and disabling.                                                                                                                                                                                                                                                                                                 | Backend specs and browser join coverage exist; no current-release deployment result recorded.                                                                                                                                               |
| Random event codes and web QR sharing  | Merged from `feat/qr-codes` (rebased onto `main`, branch head `e28abf1` plus council-review fixes; cite the PR and merge SHA when it lands). Random six-character event codes, one `/join/<code>` resolver for public codes and invite grants, and the organizer's QR dialog with download and print. `joinCodes.convex.spec.ts`, `inviteLinks.convex.spec.ts`, and the `invite-links` browser spec. | No deployment result recorded. Verify public, unlisted, private, rotated/disabled, and changed-visibility links against the release candidate. The personal dev DB was reset on 2026-11-04 for the string `publicCode` and required `seed`. |
| Native free/approval join              | Merged from `feat/qr-codes` (same PR): the `/join/<code>` screen, shared join-state hooks in `@paper-pairings/core`, withdrawal, and the web payment handoff behind `EXPO_PUBLIC_WEB_ORIGIN`.                                                                                                                                                                                                        | No device or build result recorded; verify on physical iOS and Android. Scanner, the web panel on the shared derivation, native payment return, and universal links remain planned (`docs/plans/qr-join.md`).                               |
| Organizer guest/email enrollment       | Merged in PR #50 at `7673dac`, with the follow-up fix `1d4423b`. Add-guest and enroll-by-email flows, event-local names, claim on sign-in and app open, checkout takeover of an enrolled seat, with backend specs, web dialog tests, and the `enrollment-claim` browser spec.                                                                                                                        | No deployment result recorded. Verify enrollment, claim at sign-in, and the checkout takeover of an enrolled seat against the release candidate.                                                                                            |
| Web design foundation                  | Merged PR #32, `8ca7c9d`; PR #33, `89050e3`; PR #34, `4cb170d`. Theme/branding, Overview, layout, table controls, and component styling.                                                                                                                                                                                                                                                             | Figma completion and source code establish design/implementation status. Full accessibility and responsive deployment audits remain open.                                                                                                   |
| Convention ticket types and door sales | Merged with PR #23, `1411825`; ADR 0004 and `conventions/ticketTypes.ts`. Registration spans the live convention until complete/cancel.                                                                                                                                                                                                                                                              | Specs exist; no current-release badge Checkout or door-sale deployment result recorded.                                                                                                                                                     |
| Payments and recovery                  | Payment foundation in PR #20; Connect updates in PR #30, `2fe531a`; refund recovery in PR #40, `9c0798a`; unpaid-entry sweep fix in PR #42, `721911e`.                                                                                                                                                                                                                                               | Historical sandbox exercise below. Current-release sandbox and live-mode readiness remain open.                                                                                                                                             |
| Monitoring                             | Web browser/SSR and native Sentry wiring is on `main`. Convex reporting is configured per deployment outside the codebase.                                                                                                                                                                                                                                                                           | A setup-script run for projects/DSNs was previously reported. Receipt of test events and source-map readability are not recorded. Convex Pro was the recorded backend-integration blocker; current account state was not inspected.         |
| Deployment tooling and CI              | `apps/web/vercel.json`, web-build CI added at `00b1ef5`, and `srvx` start script at `7fc16a3` are on `main`.                                                                                                                                                                                                                                                                                         | A CI build without runtime credentials is not a deployment smoke test. Vercel configuration, deployed auth/data flows, and custom domain remain unverified here.                                                                            |

The QR plan is `docs/plans/qr-join.md`. Its PR 0, PR 1, and PR 2a stage
labels mean built work; they are not GitHub PR numbers or merge evidence, and
PR 2b onward is planned. The plan's "Current state" section predates the
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
