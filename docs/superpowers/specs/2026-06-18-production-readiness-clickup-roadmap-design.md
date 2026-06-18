# Production Readiness ClickUp Roadmap Design

## Purpose

Build a dependency-driven roadmap in the ClickUp `Tournament Software` space
that takes Tournament OS from its current state to a fully end-to-end closed
beta launch. The roadmap has no fixed dates. Sequencing is determined by
technical and operational dependencies.

## Launch Definition

The first production milestone is a closed beta of the web application.
Selected organizers must be able to run real tournaments entirely in
Tournament OS without relying on another tournament-management product.

The beta must support:

- Swiss tournaments.
- Single-elimination tournaments.
- Configurable Swiss-to-single-elimination phase transitions.
- Organizer-managed tournament setup and operations.
- Player registration, tournament participation, match reporting, and
  standings.
- Free events.
- Paid registration through Stripe Connect.
- Manual and offline payment tracking for paid events.
- A percentage-based platform fee charged on paid registrations.
- Organizer onboarding, checkout, payouts, refunds, disputes, and payment
  reconciliation.
- Complete event lifecycle through final results and event completion.

Organizer subscriptions are outside the product model. Pod play and the native
application are outside the closed-beta launch scope.

## Current Repository Baseline

The roadmap is based on a repository review performed on June 18, 2026.

- The monorepo contains a TanStack Start web application, a Convex backend, a
  shared tournament-core package, and an early Expo application.
- The production web build succeeds.
- The Convex backend test suite succeeds with 23 tests.
- The web lint command fails with 152 errors and 9 warnings.
- Existing backend functionality covers organizations, tournament creation,
  registration, Swiss pairing, standings, organizer result entry, and player
  result reporting.
- Single-elimination phases are not implemented.
- Stripe payments are not implemented.
- Continuous integration, browser end-to-end tests, production monitoring,
  and incident operations are not present in the repository.
- The Expo application is an early player client and is not required for the
  first launch.
- The ClickUp `Tournament Software` space currently contains one empty list
  and no tasks, so no existing roadmap taxonomy needs to be preserved.

## ClickUp Information Architecture

Use capability workstreams so each list remains useful for day-to-day
engineering while explicit dependencies reveal the launch sequence.

The `Tournament Software` space will contain these lists:

1. Product & Architecture
2. Platform Foundation
3. Tournament Engine
4. Registration & Stripe Connect
5. Organizer Web
6. Player Web
7. Quality, Security & Operations
8. Closed Beta Readiness
9. Post-Beta Native

The existing generic empty list may be renamed to `Product & Architecture`.
The other lists will be created directly in the space.

## Task Model

Parent tasks represent outcome-based epics. Complex epics are decomposed into
subtasks representing concrete deliverables. Each parent and subtask will have
a description containing:

- Why the work matters.
- Defined scope.
- Acceptance criteria.
- Relevant repository evidence or implementation notes when useful.

Tasks will not receive speculative assignees or dates. Priorities reflect
closed-beta criticality:

- Urgent: launch gate, security, payment integrity, or core event correctness.
- High: required closed-beta capability.
- Normal: valuable hardening that is not on the immediate critical path.
- Low: explicitly post-beta work.

Subtasks should be implementation-sized and independently verifiable. Tiny
mechanical steps belong in acceptance criteria or checklists rather than
becoming separate ClickUp tasks.

## Dependency Model

Dependencies use true blocking relationships, not decorative links. A task is
blocked only when work cannot safely finish before its prerequisite.

The high-level critical path is:

```text
Product decisions and platform foundation
  -> tournament engine completion
  -> organizer and player end-to-end flows
  -> Stripe payment lifecycle
  -> automated end-to-end verification
  -> production hardening
  -> pilot tournaments
  -> closed beta launch
```

Independent workstreams may proceed in parallel. For example, observability
design and accessibility remediation need not wait for Stripe implementation.

The final `Launch closed beta` task is blocked by explicit readiness milestones
covering:

- Core tournament correctness.
- Registration and payment correctness.
- Organizer workflow readiness.
- Player workflow readiness.
- Security and privacy readiness.
- Reliability and operational readiness.
- Automated quality gates.
- Successful pilot tournaments.

## Workstream Scope

### Product & Architecture

Define beta policies and architecture decisions that downstream implementation
depends on. This includes the beta operating model, supported tournament rules,
platform fee and refund policies, manual-payment semantics, data retention,
legal requirements, and architecture decision records for Stripe Connect and
tournament phases.

### Platform Foundation

Make the monorepo consistently buildable, testable, deployable, and
environment-safe. This includes eliminating lint debt, aligning package
versions and scripts, validating environment variables, adding continuous
integration, defining preview/staging/production environments, and establishing
safe Convex deployment and migration practices.

### Tournament Engine

Complete and harden the tournament domain. This includes Swiss correctness,
single-elimination brackets, phase transitions, drops and disqualifications,
result correction, tournament completion, deterministic recovery behavior,
audit history, and concurrency-safe event operations.

### Registration & Stripe Connect

Implement the complete money lifecycle without subscriptions. This includes
organizer Connect onboarding, paid and free event configuration, hosted
checkout, platform fees, webhook processing, registration/payment state
machines, manual payments, refunds, disputes, payouts, reconciliation, and
financial administration.

### Organizer Web

Deliver a coherent organizer workflow from organization setup through completed
event. The workstream covers tournament configuration, registration desk,
payment visibility, round operations, bracket management, result correction,
staff permissions, event completion, responsive behavior, and actionable error
states.

### Player Web

Deliver the complete browser-based player experience: discovery or invite
entry, registration and payment, current match, result reporting and
confirmation, standings and bracket views, dropping, receipts and refund
status, and mobile-browser usability.

### Quality, Security & Operations

Create confidence and operational safety. This includes unit and integration
coverage, browser end-to-end testing, payment test matrices, authorization
review, dependency and secret scanning, accessibility, performance, monitoring,
alerting, backups and recovery, runbooks, privacy and terms, support tooling,
and incident response.

### Closed Beta Readiness

Represent cross-functional gates rather than feature implementation. This
includes beta organizer recruitment and onboarding, test-data and sandbox
preparation, internal rehearsals, pilot tournaments, issue triage, go/no-go
review, launch, and post-event feedback loops.

### Post-Beta Native

Keep native work visible without allowing it to block the web beta. This
includes feature parity planning, result reporting, registration and payment
handoff, mobile release infrastructure, store preparation, and native
observability.

## Verification

After creating the roadmap:

1. Confirm all nine lists exist in the `Tournament Software` space.
2. Confirm every complex epic has meaningful subtasks.
3. Confirm every task has scope and acceptance criteria.
4. Confirm launch-critical work has an appropriate priority.
5. Traverse the dependency graph to ensure there are no cycles.
6. Confirm every final readiness gate blocks `Launch closed beta`.
7. Confirm post-beta native tasks do not block the web launch.
8. Confirm no dates or speculative assignees were added.

## Out of Scope

- Fixed delivery dates or sprint assignments.
- Assigning work to team members.
- Organizer subscriptions.
- Pod-play formats.
- Native application launch as a beta prerequisite.
- Implementing repository changes as part of this roadmap-building task.
