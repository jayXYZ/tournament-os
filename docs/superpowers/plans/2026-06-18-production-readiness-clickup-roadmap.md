# Production Readiness ClickUp Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the ClickUp `Tournament Software` space with a complete, dependency-driven roadmap for an end-to-end web closed beta.

**Architecture:** Capability workstreams are represented as ClickUp lists. Outcome-based epics are parent tasks, concrete deliverables are subtasks, and a small set of cross-workstream readiness gates forms the launch dependency graph. Native work is explicitly post-beta and has no dependency path to launch.

**Tech Stack:** ClickUp lists, tasks, subtasks, priorities, task dependencies, and the existing Tournament OS monorepo as roadmap evidence.

---

## Creation Rules

- Use no dates and no assignees.
- Use `urgent` for payment integrity, event correctness, security, and launch
  gates; `high` for required beta capabilities; `normal` for supporting work;
  and `low` for native post-beta work.
- Every epic description must contain `Outcome`, `Scope`, and
  `Acceptance criteria` sections.
- Every subtask description must contain `Deliverable` and
  `Acceptance criteria` sections.
- Create true ClickUp blocking dependencies for every edge in the dependency
  matrix. Do not substitute plain-text references.
- Do not create dependencies between subtasks unless the dependency is
  necessary to execute the work safely.

## Task Catalog

### Product & Architecture

#### PA-1 Define the closed beta operating model — high

Outcome: Establish who the beta serves, how access is controlled, and how
success is measured.

Subtasks:

- Define organizer selection and onboarding criteria.
- Define beta success, exit, and rollback criteria.
- Define support boundaries and feedback cadence.

Acceptance criteria:

- The target organizer profile, participant limits, support channel, incident
  expectations, and measurable success criteria are documented.
- A beta can be paused or rolled back using explicit criteria.

#### PA-2 Finalize tournament rules and lifecycle policy — urgent

Outcome: Remove ambiguity from Swiss, single-elimination, and phase-transition
behavior before engine implementation.

Subtasks:

- Specify Swiss pairing, bye, tie-break, drop, and correction rules.
- Specify single-elimination seeding, bye, draw, and advancement rules.
- Specify Swiss-to-elimination cut, seeding, and locked-state rules.
- Define cancellation, completion, and exceptional recovery behavior.

Acceptance criteria:

- Every supported lifecycle transition and exceptional state has one
  unambiguous expected outcome.
- Rules are suitable for direct conversion into automated tests.

#### PA-3 Define payments, finance, and legal policy — urgent

Outcome: Establish the commercial and compliance rules for percentage-based
paid registration.

Subtasks:

- Set platform-fee, currency, minimum-fee, and rounding policy.
- Define refund, cancellation, dispute, and payout-responsibility policy.
- Define manual/offline payment semantics and organizer accountability.
- Define privacy, terms, consent, retention, and financial-record requirements.

Acceptance criteria:

- Product behavior is defined for free, Stripe-paid, and manually paid entries.
- Organizer and platform responsibilities are explicit for refunds, disputes,
  taxes, payouts, and retained records.

#### PA-4 Record production architecture decisions — high

Outcome: Lock the architectural choices needed by the implementation
workstreams.

Subtasks:

- Record the Stripe Connect charge and platform-fee model.
- Record the registration and payment state machines.
- Record the tournament phase, bracket, and audit-event model.

Acceptance criteria:

- Decisions include alternatives considered, the selected approach, failure
  handling, and operational consequences.

### Platform Foundation

#### PF-1 Restore a clean engineering baseline — high

Outcome: Make all repository-level quality commands reliable.

Subtasks:

- Eliminate the current web lint errors and warnings.
- Add root scripts for lint, typecheck, unit tests, and full verification.
- Align shared dependency versions and workspace package boundaries.

Acceptance criteria:

- A clean checkout passes install, lint, typecheck, tests, and production build.
- The root commands cover web, backend, core, and native where applicable.

#### PF-2 Add continuous integration quality gates — high

Outcome: Prevent broken changes from reaching the release branch.

Subtasks:

- Run install, lint, typecheck, unit tests, and build in CI.
- Cache pnpm dependencies and fail on lockfile drift.
- Publish actionable failure output and branch-protection guidance.

Acceptance criteria:

- Every pull request runs the complete deterministic verification suite.
- A failing required check blocks merge.

#### PF-3 Establish environment and secret management — urgent

Outcome: Separate development, preview, staging, and production safely.

Subtasks:

- Define and validate required web, Convex, Clerk, and Stripe variables.
- Provision isolated staging and production service configurations.
- Document secret rotation and least-privilege access.

Acceptance criteria:

- Missing or invalid variables fail fast without leaking values.
- Test and live Stripe credentials cannot be mixed.
- Production data and auth tenants are isolated from development.

#### PF-4 Build a repeatable deployment and rollback pipeline — urgent

Outcome: Deploy the web and Convex backend together without manual guesswork.

Subtasks:

- Define preview, staging, and production deployment workflows.
- Add safe Convex schema migration and deployment checks.
- Document rollback, forward-fix, and release-verification procedures.

Acceptance criteria:

- A release can be promoted from staging to production with recorded checks.
- Failed application or schema releases have a tested recovery path.

#### PF-5 Establish release configuration and ownership — normal

Outcome: Make operational ownership and release contents visible.

Subtasks:

- Define release notes and change-classification conventions.
- Create environment ownership and access inventory.
- Document supported browser and device targets.

Acceptance criteria:

- Each release identifies user-visible changes, migrations, owners, and known
  risks.

### Tournament Engine

#### TE-1 Harden Swiss tournament correctness — urgent

Outcome: Make existing Swiss operations trustworthy under real event load.

Subtasks:

- Expand deterministic pairing tests for odd fields, byes, drops, and repeats.
- Verify tie-break calculations and standings snapshots across rounds.
- Make duplicate round generation and duplicate result submission idempotent.
- Add organizer correction and rollback tests.

Acceptance criteria:

- The agreed Swiss rules pass automated edge-case and concurrency tests.
- Repeated or conflicting commands cannot silently corrupt standings.

#### TE-2 Implement the single-elimination domain model — urgent

Outcome: Represent seeded brackets and advancement as first-class tournament
data.

Subtasks:

- Add bracket, seed, round, match, and advancement schema.
- Add validators, indexes, and migration/backfill strategy.
- Add domain helpers for bracket sizing and bye placement.

Acceptance criteria:

- Brackets support power-of-two expansion, deterministic byes, and immutable
  seed provenance.
- Schema and helpers have focused automated tests.

#### TE-3 Implement single-elimination execution — urgent

Outcome: Generate and run elimination brackets through a champion.

Subtasks:

- Generate the initial bracket from ordered seeds.
- Advance winners and handle byes without phantom matches.
- Record, correct, and invalidate elimination results safely.
- Complete the bracket and persist champion/final placements.

Acceptance criteria:

- Brackets run end-to-end for representative field sizes.
- Corrections update downstream matches safely or require an explicit recovery
  flow when play has advanced.

#### TE-4 Implement Swiss-to-elimination phase transitions — urgent

Outcome: Move qualified players from completed Swiss standings into a locked
elimination bracket.

Subtasks:

- Configure cut size and transition eligibility.
- Lock final Swiss standings and derive elimination seeds.
- Generate the bracket and expose transition audit details.

Acceptance criteria:

- Transition is unavailable until Swiss completion.
- Repeated transition requests are idempotent.
- Seed ordering and tie resolution match the approved rules.

#### TE-5 Complete lifecycle exceptions and auditability — high

Outcome: Make exceptional organizer actions recoverable and explainable.

Subtasks:

- Implement drop, disqualification, cancellation, and no-show semantics.
- Add immutable audit events for privileged tournament changes.
- Add guarded recovery operations for malformed or interrupted rounds.

Acceptance criteria:

- Privileged changes identify actor, time, previous state, and resulting state.
- Recovery tools cannot bypass organization authorization.

#### TE-6 Validate engine scale and contention behavior — high

Outcome: Verify real-time operations remain safe at beta tournament sizes.

Subtasks:

- Define beta field-size and concurrent-action load scenarios.
- Measure Convex reads, writes, contention, and subscription fan-out.
- Remove critical read amplification and optimistic-concurrency hotspots.

Acceptance criteria:

- The engine meets documented beta capacity targets with no correctness loss.
- Known capacity limits and operator mitigations are documented.

### Registration & Stripe Connect

#### RS-1 Implement Stripe Connect platform foundation — urgent

Outcome: Establish the platform account, Connect model, and secure Stripe
integration boundary.

Subtasks:

- Configure test/live Stripe accounts and Connect capabilities.
- Add server-side Stripe client and typed configuration.
- Implement signed webhook ingress with replay protection.
- Define Stripe object metadata and internal identifier conventions.

Acceptance criteria:

- Secrets never reach clients.
- Webhooks reject invalid signatures and safely accept retries.
- Test and live objects are unambiguously separated.

#### RS-2 Implement organizer Connect onboarding — urgent

Outcome: Allow an organization to become eligible to collect entry fees.

Subtasks:

- Create and persist connected-account ownership.
- Launch and resume hosted onboarding.
- Synchronize capability, requirement, and payout status.
- Surface remediation for incomplete or restricted accounts.

Acceptance criteria:

- Only authorized organization owners can manage onboarding.
- Paid events cannot open until the account has the required capabilities.

#### RS-3 Add event pricing and registration payment state — urgent

Outcome: Represent free, Stripe-paid, and manual/offline registrations without
ambiguous states.

Subtasks:

- Extend event pricing and currency configuration.
- Add payment, refund, dispute, and reconciliation records.
- Implement validated registration/payment state transitions.
- Define unique constraints and idempotency keys.

Acceptance criteria:

- Registration status and money status are distinct but consistent.
- Invalid transitions fail without partial writes.

#### RS-4 Implement player checkout and platform fees — urgent

Outcome: Convert a paid event registration into a secure Stripe Checkout
payment with a percentage platform fee.

Subtasks:

- Create authorized Checkout Sessions for available event capacity.
- Calculate and persist platform fees using the approved rounding policy.
- Finalize registration from authoritative webhook events.
- Handle abandoned, expired, duplicated, and late checkout events.

Acceptance criteria:

- Client redirects cannot mark a registration paid.
- Capacity and duplicate-registration races are handled safely.
- Gross, fee, Stripe fee, and organizer net are traceable.

#### RS-5 Implement manual/offline payment workflows — high

Outcome: Let organizers record non-Stripe payment while preserving financial
clarity.

Subtasks:

- Add authorized manual-payment capture and notes.
- Add correction, void, and audit behavior.
- Distinguish expected, collected, refunded, and outstanding amounts.

Acceptance criteria:

- Manual payments never create Stripe objects or platform fees.
- Every change is attributable and visible in reconciliation.

#### RS-6 Implement refunds, cancellations, and disputes — urgent

Outcome: Handle the complete post-payment exception lifecycle.

Subtasks:

- Implement full and policy-supported partial refunds.
- Synchronize cancellation and refund webhooks idempotently.
- Ingest disputes and evidence deadlines.
- Define registration access behavior during refunds and disputes.

Acceptance criteria:

- Refund totals cannot exceed captured amounts.
- Duplicate events do not duplicate refunds or state transitions.
- Operators can identify every unresolved dispute.

#### RS-7 Implement payouts and reconciliation — urgent

Outcome: Give organizers and operators an auditable view of money movement.

Subtasks:

- Synchronize transfers, payouts, failures, and reversals.
- Build per-event and per-organization reconciliation summaries.
- Flag mismatches between internal records and Stripe balances.
- Add exportable finance records and operator remediation notes.

Acceptance criteria:

- Every paid registration reconciles to a known terminal or actionable state.
- Payout failures and reconciliation mismatches are visible and alertable.

### Organizer Web

#### OW-1 Complete tournament configuration workflows — high

Outcome: Configure publishable Swiss and Swiss-to-elimination events from the
organizer UI.

Subtasks:

- Add format, phases, cut size, pricing, capacity, and registration settings.
- Add validation summaries and setup-readiness checks.
- Lock unsafe settings after registrations or play begin.

Acceptance criteria:

- Organizers cannot publish an invalid event.
- UI locks and backend authorization enforce the same rules.

#### OW-2 Build the registration desk and payment console — high

Outcome: Manage attendees and payment status at check-in.

Subtasks:

- Add search, check-in, waitlist, drop, and capacity controls.
- Show Stripe, free, manual, refund, dispute, and outstanding states.
- Add authorized manual-payment and refund actions.
- Add CSV export for registration and finance review.

Acceptance criteria:

- Staff can resolve normal registration issues without direct database access.
- Sensitive financial actions require an appropriate role and confirmation.

#### OW-3 Complete live tournament operations — urgent

Outcome: Run rounds and resolve match issues from one dependable workspace.

Subtasks:

- Add round generation, publishing, timer, completion, and next-round controls.
- Add result confirmation, override, correction, and conflict handling.
- Add drop, disqualification, table reassignment, and operator notes.
- Add recoverable loading, empty, offline, and mutation-error states.

Acceptance criteria:

- A trained organizer can operate a complete Swiss event without developer
  assistance.
- Dangerous actions are guarded and leave audit history.

#### OW-4 Add elimination bracket and phase controls — urgent

Outcome: Operate cuts and single-elimination play visually.

Subtasks:

- Preview and confirm the Swiss cut and seeding.
- Render a responsive bracket with match state.
- Add elimination result correction and advancement controls.

Acceptance criteria:

- Organizers can inspect seeding before bracket creation.
- Bracket state remains understandable on common laptop and tablet sizes.

#### OW-5 Finish staff, completion, and event-history workflows — high

Outcome: Make permissions and post-event operations production-safe.

Subtasks:

- Complete invitation acceptance, role changes, revocation, and least privilege.
- Add event completion confirmation and immutable final results.
- Add completed-event history, audit timeline, and finance summary.

Acceptance criteria:

- Staff permissions are enforced server-side.
- Completed events remain readable and auditable but cannot be casually mutated.

### Player Web

#### PW-1 Complete event discovery and registration — high

Outcome: Let players understand and enter eligible events from the browser.

Subtasks:

- Add public event details, capacity, price, format, and registration state.
- Add authenticated free and paid registration flows.
- Add duplicate, full, closed, and waitlist handling.

Acceptance criteria:

- Players see the total price and relevant policy before committing.
- Registration state remains correct across refreshes and multiple devices.

#### PW-2 Complete payment, receipt, and exception UX — high

Outcome: Make paid registration status understandable after checkout.

Subtasks:

- Add checkout return, pending, success, failure, and expiration states.
- Add receipts and organizer payment-contact information.
- Show refund and dispute-related access/status changes.

Acceptance criteria:

- The UI never treats a redirect alone as payment confirmation.
- Players can identify what happened and what action is available.

#### PW-3 Harden live match and result reporting — urgent

Outcome: Let players participate reliably from mobile browsers.

Subtasks:

- Show current table, opponent, round, timer, and confirmation state.
- Harden result reporting, opponent confirmation, correction, and conflict UX.
- Add reconnect, stale-state, and duplicate-submission handling.

Acceptance criteria:

- Two players cannot unknowingly finalize contradictory results.
- Live state recovers cleanly after browser suspension or reconnect.

#### PW-4 Add standings, bracket, and tournament completion views — high

Outcome: Give players a complete live and post-event picture.

Subtasks:

- Add phase-aware standings and tie-break explanations.
- Add responsive single-elimination bracket viewing.
- Add final placement, champion, and completed-event summary.

Acceptance criteria:

- Views identify whether data is live, provisional, or final.
- Common phone widths do not require desktop-only interaction.

#### PW-5 Complete player self-service actions — high

Outcome: Reduce organizer intervention for routine player needs.

Subtasks:

- Add drop confirmation and policy-aware refund request entry.
- Add registration cancellation where policy permits.
- Add account/tournament history and support escalation links.

Acceptance criteria:

- Self-service actions enforce event state and refund policy server-side.
- Players receive an unambiguous resulting status.

### Quality, Security & Operations

#### QO-1 Build the automated test pyramid — high

Outcome: Cover business rules and cross-package behavior below the browser
layer.

Subtasks:

- Add missing core unit tests for rules and financial calculations.
- Add Convex integration tests for authorization and state machines.
- Add deterministic fixtures for Swiss, elimination, and payment scenarios.

Acceptance criteria:

- Critical domain branches have direct automated coverage.
- Fixtures do not depend on live third-party services.

#### QO-2 Add browser end-to-end release tests — urgent

Outcome: Verify the complete organizer/player product through real browser
flows.

Subtasks:

- Set up Playwright projects and isolated test data.
- Cover organization setup, free registration, Swiss event, and completion.
- Cover paid registration, refund, Swiss cut, elimination, and champion.
- Capture traces, screenshots, and actionable artifacts on failure.

Acceptance criteria:

- Critical closed-beta journeys run in CI against a deploy-like environment.
- Tests prove role separation between organizer and player accounts.

#### QO-3 Complete payment integration testing — urgent

Outcome: Exercise Stripe lifecycle behavior beyond happy-path checkout.

Subtasks:

- Test webhook retries, reordering, duplicates, and invalid signatures.
- Test refunds, disputes, payout failures, and reconciliation mismatches.
- Run Stripe test-clock or equivalent lifecycle scenarios where applicable.

Acceptance criteria:

- Payment handlers are idempotent under the documented event matrix.
- Every failure mode produces an actionable internal state.

#### QO-4 Complete security and privacy hardening — urgent

Outcome: Protect accounts, event operations, personal data, and financial
actions.

Subtasks:

- Audit every public Convex function and organization authorization boundary.
- Add dependency, secret, and static-analysis scanning.
- Review upload, webhook, redirect, rate-limit, and abuse surfaces.
- Implement privacy controls and legal disclosures from PA-3.

Acceptance criteria:

- No sensitive mutation trusts a client-supplied identity.
- Critical findings are resolved or explicitly block launch.
- Privacy and terms are accessible before registration/payment.

#### QO-5 Add observability and incident detection — urgent

Outcome: Detect user-impacting failures before support reports accumulate.

Subtasks:

- Add structured error reporting for web and backend.
- Add product and payment health metrics without sensitive payloads.
- Configure alerts for checkout, webhook, payout, deployment, and event failures.

Acceptance criteria:

- Alerts identify environment, affected capability, and investigation entry
  point.
- Sensitive personal and payment data is excluded from telemetry.

#### QO-6 Establish reliability, recovery, and operator runbooks — urgent

Outcome: Recover from service, data, payment, and live-event incidents.

Subtasks:

- Define and test backup/export and restoration procedures.
- Write deployment rollback, payment, auth, and live-event incident runbooks.
- Define support triage, severity, escalation, and communication procedures.
- Conduct a tabletop recovery exercise.

Acceptance criteria:

- Operators can execute critical recovery steps without undocumented knowledge.
- Recovery objectives and limitations are explicit.

#### QO-7 Complete accessibility, compatibility, and performance work — high

Outcome: Make critical workflows usable on beta devices and assistive
technology.

Subtasks:

- Audit keyboard, focus, labels, contrast, and screen-reader behavior.
- Test supported mobile and desktop browser matrix.
- Set and verify page-load, mutation-feedback, and live-update budgets.

Acceptance criteria:

- Critical flows meet the agreed accessibility baseline.
- No supported device has a launch-blocking workflow defect.

### Closed Beta Readiness

#### CB-1 Prepare the beta program — high

Subtasks:

- Recruit and qualify beta organizers.
- Create onboarding, training, support, and feedback materials.
- Prepare isolated test organizations and Stripe test-mode accounts.

Acceptance criteria:

- Selected organizers understand scope, support, and incident expectations.

#### CB-2 Run internal end-to-end rehearsals — urgent

Subtasks:

- Rehearse a free Swiss event through completion.
- Rehearse a paid Swiss-to-elimination event through payout/refund review.
- Record defects, operator friction, and runbook gaps.

Acceptance criteria:

- Both rehearsals complete without direct database repair.
- All launch-blocking findings are tracked.

#### CB-3 Run live pilot tournaments — urgent

Subtasks:

- Run a supervised free pilot with real players.
- Run a supervised paid pilot with Stripe Connect.
- Reconcile results, money, incidents, and participant feedback.

Acceptance criteria:

- At least one free and one paid real event complete end-to-end.
- No unresolved correctness, security, or financial-integrity defect remains.

#### CB-G1 Core tournament readiness gate — urgent

Acceptance criteria:

- Swiss, elimination, transitions, corrections, lifecycle exceptions, and scale
  checks are complete.

#### CB-G2 Registration and payment readiness gate — urgent

Acceptance criteria:

- Free, Stripe, manual, refund, dispute, payout, and reconciliation flows are
  complete and tested.

#### CB-G3 Organizer workflow readiness gate — urgent

Acceptance criteria:

- Setup, registration desk, live operations, bracket, staff, and completion
  workflows are complete.

#### CB-G4 Player workflow readiness gate — urgent

Acceptance criteria:

- Registration, payment status, live match, reporting, standings, bracket, and
  self-service workflows are complete.

#### CB-G5 Security and privacy readiness gate — urgent

Acceptance criteria:

- Security review, scanning, privacy controls, and legal disclosures have no
  unresolved launch blocker.

#### CB-G6 Reliability and operations readiness gate — urgent

Acceptance criteria:

- Deployment, observability, alerts, recovery, and incident runbooks are
  verified.

#### CB-G7 Automated quality readiness gate — urgent

Acceptance criteria:

- CI, unit/integration, browser E2E, payment, compatibility, and accessibility
  quality gates pass.

#### CB-G8 Pilot validation gate — urgent

Acceptance criteria:

- Required rehearsals and live pilots are complete and blocking findings are
  closed.

#### CB-4 Conduct go/no-go review — urgent

Acceptance criteria:

- All eight readiness gates are complete.
- Remaining known issues have explicit acceptance, owner, and mitigation.

#### CB-5 Launch closed beta — urgent

Acceptance criteria:

- Go/no-go approval is recorded.
- Access, support, monitoring, and incident coverage are active.

#### CB-6 Run post-launch feedback and triage loop — high

Subtasks:

- Review telemetry, support, and organizer feedback after each beta event.
- Prioritize defects and product gaps against beta exit criteria.
- Publish recurring beta health summaries.

Acceptance criteria:

- Feedback produces visible decisions and tracked follow-up work.

### Post-Beta Native

#### NB-1 Define native parity and release strategy — low

Subtasks:

- Define native target users and web/native responsibility boundaries.
- Prioritize parity gaps and offline expectations.
- Define store, privacy, and release requirements.

Acceptance criteria:

- Native scope is sequenced after web beta evidence, not assumed to be parity.

#### NB-2 Complete native player event flows — low

Subtasks:

- Complete tournament list and event detail states.
- Add live match, result reporting, confirmation, standings, and bracket.
- Add resilient auth, token refresh, reconnect, and deep linking.

Acceptance criteria:

- Native critical flows meet the same server-side rules as web.

#### NB-3 Add native registration, payments, and operations — low

Subtasks:

- Add free registration and secure hosted-checkout handoff.
- Add receipt/refund status and support links.
- Add crash reporting, EAS build profiles, signing, store submission, and
  staged rollout.

Acceptance criteria:

- Payment confirmation remains webhook-authoritative.
- Production builds are observable and reproducible.

## Dependency Matrix

Each row means `Blocked task` cannot complete until every listed prerequisite
is complete.

| Blocked task | Prerequisites |
| --- | --- |
| PA-4 | PA-2, PA-3 |
| PF-2 | PF-1 |
| PF-4 | PF-2, PF-3 |
| TE-1 | PA-2 |
| TE-2 | PA-2, PA-4 |
| TE-3 | TE-2 |
| TE-4 | TE-1, TE-3 |
| TE-5 | PA-2, PA-4 |
| TE-6 | TE-1, TE-3, TE-4, TE-5 |
| RS-1 | PA-3, PA-4, PF-3 |
| RS-2 | RS-1 |
| RS-3 | PA-3, PA-4 |
| RS-4 | RS-1, RS-2, RS-3 |
| RS-5 | RS-3 |
| RS-6 | RS-4 |
| RS-7 | RS-4, RS-5, RS-6 |
| OW-1 | PA-2, TE-2, RS-3 |
| OW-2 | RS-4, RS-5, RS-6 |
| OW-3 | TE-1, TE-5 |
| OW-4 | TE-3, TE-4 |
| OW-5 | TE-5 |
| PW-1 | RS-3, RS-4 |
| PW-2 | RS-4, RS-6 |
| PW-3 | TE-1, TE-5 |
| PW-4 | TE-3, TE-4 |
| PW-5 | RS-5, RS-6, TE-5 |
| QO-2 | OW-1, OW-2, OW-3, OW-4, PW-1, PW-2, PW-3, PW-4 |
| QO-3 | RS-4, RS-6, RS-7 |
| QO-4 | PA-3, PF-3, RS-1 |
| QO-5 | PF-3, RS-1 |
| QO-6 | PF-4, QO-5 |
| QO-7 | OW-1, OW-2, OW-3, OW-4, PW-1, PW-2, PW-3, PW-4 |
| CB-2 | PF-4, QO-2, QO-3, QO-4, QO-5, QO-6 |
| CB-3 | CB-2 |
| CB-G1 | TE-6 |
| CB-G2 | RS-7, QO-3 |
| CB-G3 | OW-1, OW-2, OW-3, OW-4, OW-5 |
| CB-G4 | PW-1, PW-2, PW-3, PW-4, PW-5 |
| CB-G5 | QO-4 |
| CB-G6 | PF-4, QO-5, QO-6 |
| CB-G7 | PF-2, QO-1, QO-2, QO-3, QO-7 |
| CB-G8 | CB-3 |
| CB-4 | CB-G1, CB-G2, CB-G3, CB-G4, CB-G5, CB-G6, CB-G7, CB-G8 |
| CB-5 | CB-4 |
| CB-6 | CB-5 |

No `NB-*` task is a prerequisite for any closed-beta task.

## Execution Tasks

### Task 1: Create the ClickUp workstream lists

- [ ] Rename existing list `901417379160` to `Product & Architecture`.
- [ ] Create the remaining eight lists in space `90146116981`.
- [ ] Retrieve and record all resulting list IDs.

### Task 2: Create all parent epics

- [ ] Create every catalog epic in its matching list with its priority,
  outcome, scope, and acceptance criteria.
- [ ] Record a mapping from catalog key to ClickUp task ID.
- [ ] Verify no dates or assignees were set.

### Task 3: Create all complex-task subtasks

- [ ] Create every listed subtask beneath its catalog epic.
- [ ] Give each subtask a deliverable and concrete acceptance criteria.
- [ ] Verify all implementation epics have at least two meaningful subtasks.

### Task 4: Link blocking dependencies

- [ ] Add every dependency edge in the matrix as a true ClickUp dependency.
- [ ] Confirm the direction is prerequisite blocks blocked task.
- [ ] Confirm native tasks have no path to `CB-5`.

### Task 5: Verify the completed roadmap

- [ ] Retrieve all nine lists and their tasks.
- [ ] Spot-check task descriptions, priorities, subtasks, and readiness gates.
- [ ] Traverse the dependency matrix and confirm no cycle exists.
- [ ] Confirm `CB-5 Launch closed beta` is blocked by `CB-4 Conduct go/no-go
  review`.
- [ ] Confirm every readiness gate blocks `CB-4`.
- [ ] Record any connector or ClickUp limitation explicitly rather than
  representing an unlinked dependency as complete.

