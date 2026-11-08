# Paper Pairings roadmap

Audited 2026-10-28 against `main` and fetched `origin/main` at `7fc16a3`,
plus the feature branches listed in [delivery status](docs/delivery-status.md).
Section numbers are stable references, not a strict execution order.

A checked implementation item means the code is merged into `main`. Work
built on a branch stays unchecked here and names that branch. Deployment
verification is a separate task with a named environment, tested revision,
date, and outcome. Tests, merges, design artifacts, and configured credentials
do not by themselves prove that a deployed workflow works. Historical checks
retain their original scope; see the delivery record for missing evidence.

A checked child under an open parent records the part already merged. Mark a
task blocked only when its next step actually requires the named prerequisite;
distinguish unverified account setup from a confirmed external block.

## Next priorities

1. Establish a release baseline in section 0: verify the Vercel deployment,
   auth, and monitoring, then repeat the payment checks in section 9 against
   that revision. Record the target and evidence before declaring it ready.
2. Merge, then verify in a deployment, the QR join work: random event codes
   and web QR sharing, the native free/approval join, the web panel on the
   shared derivation, the native scanner, and the review fixes are one PR,
   #51 (`qr/review-fixes` → `main`; the stack's first layer is
   `feat/qr-codes` at `cd1be4e`). Organizer guest/email enrollment is on
   `main`. None has a release-candidate deployment result; the browser specs
   and the Maestro suite ran against the personal dev deployment
   ([record](docs/delivery-status.md)). The native join needs a physical device. The schema changes
   landed with a dev DB reset, not a migration.
3. Close event-day gaps: remove stale confirmation copy, provide an organizer
   deck-check view and printable pairings/standings, and finish native player
   controls. These can proceed while account setup is pending.
4. Build judge permissions and adjudication in section 5, then their E2E
   cases. Late entry follows organizer admission; publication policy precedes
   public decklists; the outbox precedes external notifications.

Cross-border payments, local-currency pricing, favorites, and advanced
convention management remain later work. This ordering does not make every
open feature a launch requirement.

## 0. Delivery guardrails

Cross-cutting foundations are listed under "Completed foundations" below.
The open work separates missing coverage from deployment verification.

- [ ] Extend the browser E2E suite with no-show and forfeit scenarios once
      the judge adjudication actions land (section 5; until then a forfeit
      is covered by manually entering the match result). Already covered:
      the organizer happy path, active-round corrections with audit trail,
      pairing rewind, organizer drops, mid-round drop concession, invite
      links and the join QR dialog (PR #51), and
      organizer email enrollment claimed at sign-in (`apps/web/e2e/`)
- [ ] Verify web browser/SSR and native Sentry capture, with readable source
      locations, in the intended deployments/builds. Wiring is merged and a
      setup-script run was previously reported; event receipt and source-map
      verification are not recorded (`docs/error-monitoring.md`).
- [ ] Enable and verify Convex exception reporting. The recorded blocker is
      the Convex Pro integration requirement; confirm the current team plan
      and target deployment before carrying that blocker forward. No backend
      Sentry wiring is delivered merely by configuring the client DSNs.
- [ ] Verify the Vercel production deployment end-to-end. First confirm
      `CONVEX_DEPLOY_KEY`, root directory `apps/web`, workspace-root install,
      and the environment contract. The pnpm build command and `srvx` start
      script are merged; deployment success is not recorded. Exercise SSR,
      sign-in/auth recovery, registration, result entry, and a user-facing
      refusal; record the URL, deployed SHA, and outcome.
- [ ] Configure and verify the custom domain, including DNS, TLS, auth
      origins, and payment redirects. Account-side setup remains unverified;
      universal links in section 8 depend on a stable domain.
  - [ ] Print join links and QR codes from the canonical domain: they are
        built from `window.location.origin` today
        (`tournament-manager/join-link.ts`), so a poster printed from a
        Vercel preview stops working with the preview. Source the origin
        from a public env var once the domain exists
- [ ] Extend browser coverage for approval, waitlist/rejection, and paid
      registration states, plus invite rotation and disabling. On `main`
      the invite E2E covers creation and joining; the broader grant rules
      have backend specs. In PR #51 the invite-links spec also covers
      rotation and disabling (each confirmation, and the old link no longer
      opening the event), the join QR dialog, and the signed-out "Sign in to
      view this event" state.

## 1. Result and adjudication foundation

Build one result model and transition path before adding more result-entry
surfaces. It should support played results, corrections, draws, forfeits,
no-shows, and disqualifications without each workflow inventing its own rules.

- [x] Add a match policy to each phase (best-of-1/3/5, default 3, pre-start
      editable — see CONTEXT.md "Match Structure"): `bestOf` on
      `tournamentPhases` (required field — reset the dev DB), a Match
      structure selector in the phase editor, and shared rules in
      `@paper-pairings/shared/match-structure`
  - [x] Configure Best-of-X / match structure per phase
  - [x] Derive valid result entry from the phase policy instead of hardcoding
        0–2 game wins: `requireValidMatchResult` in the one result writer
        enforces each side ≤ required wins and non-drawn games ≤ X, byes and
        the test simulator award structure-relative scorelines, and both
        result-entry UIs cap inputs at the required wins (the drawn-games ≤ 3
        bound landed with game-draw tracking in the adjudication model below)
  - [x] Define whether draws are allowed for the phase type: fixed by phase
        type, not configurable — equal game wins is a valid Swiss match draw
        at any structure (0–0 in best of 1, 2–2 in best of 5) and never valid
        in single elimination; recording drawn games themselves lands with the
        adjudication model below
- [x] Replace the wins-only result shape with a normalized adjudication model
  - [x] Track game wins, game losses, and game draws: `gameDraws` flows from
        both entry surfaces through `applyMatchResult` onto the match-player
        rows, audit lines, standings, and every scoreline display
  - [x] Compute match-win and game-win percentages from match/game points so
        drawn games count (MTR Appendix C)
  - [x] Exclude byes from a player's percentages where they feed opponents'
        tiebreakers: cumulative `byeCount`/`byeGameWins` produce the
        bye-excluded feed variants, while a player's own GWP keeps their
        byes' awarded games (MTR literal)
  - [x] Break residual perfect ties with a per-player random value fixed for
        the tournament instead of registration time: `tiebreakRandom` on the
        registration, hashed from the tournament seed and the user's stable
        publicCode (player number for seeded test players) so same-seed
        pairings stay reproducible across reseeds
  - [x] Distinguish played results, intentional draws, concessions, forfeits,
        no-shows, byes, and DQs: the revision kind vocabulary and explicit
        per-player outcomes exist (no intentional-draw kind by design — an ID
        is an ordinary drawn match); `played`, `bye`, and `concession` (drop
        concessions) have writers; forfeit/no-show/DQ writers land with
        section 5's judge adjudication actions
  - [x] Keep immutable result revisions and identify the current result:
        append-only `matchResultRevisions` with `currentResultRevisionId` on
        the match and an optional organizer correction note; the match-player
        rows stay the denormalized hot read model
  - [x] Preserve the previous result in the organizer audit trail for active-round overrides
- [x] Remove opponent result confirmation — the confirmed match status,
      mutation, audit event, hook, and player UI are gone; the reporter stamp
      stays for provenance and disputes resolve through organizer override
- [ ] Remove the remaining confirmation wording in the organizer Overview:
      `overview-ledger.tsx` still names `UnconfirmedResultsCard` and says
      reports are "not yet confirmed". Use player-report provenance and
      organizer correction language; reports already count toward completion.
- [x] Result corrections are active-round-only by design (decided 2026-08-12):
      organizers override results in the open round, and rewinding the latest
      untouched round reopens the previous round for fixes — including
      re-drawing a cut by rewinding the next phase's first round. Mistakes
      buried under completed rounds stand and a completed tournament is
      final, so no forward standings-recompute or cutoff-correction mechanism
      exists (see CONTEXT.md "Rewind")
  - [x] Allow organizers to enter or override results during the active round
  - [x] Recompute standings when an active round is completed
  - [x] Rewind the latest untouched round and reopen the preceding round
- [x] Complete real-event drop and adjudication handling
  - [x] Allow organizer and player drops during an event
  - [x] Keep a dropped player's current pairing available so its result can still be reported
  - [x] Record a mid-round drop as an immediate concession: both drop entry
        points route through `concedeUnfinishedMatchOnDrop`, awarding the
        opponent required-wins–0 as a "concession" revision (no
        per-tournament configuration) with a typed `match_conceded` audit
        event; a finished match is reported before the drop or fixed by
        organizer override afterwards. Decided alongside (2026-08-12):
        automatic results — byes and drop concessions — don't count as
        "touching" a round for the rewind guard, since the pairing or drop
        behind them survives the rewind; the denormalized
        `currentResultKind` on matches keeps that check read-free
        (CONTEXT.md "Rewind" updated; reset the dev DB for the new field)
  - [x] Decide where the forfeit, no-show, and DQ workflows live
        (2026-08-13): they are judge calls, not routine result entry, so the
        explicit actions move to section 5's judge operations. Until they
        land, an organizer covers a forfeit by manually entering the match
        result; the adjudication model here (revision kinds, awarded-result
        rules) stays the foundation those actions build on
  - [x] Replace bracket loser-revival with walkovers (see ADR 0001): bracket
        advancement is now by game winner regardless of participation status,
        and pairing the next round awards a departed seat-holder's scheduled
        opponent the match as a required-wins–0 bye
        (`planSingleEliminationPairings`); walkovers chain — a seat pair with
        no live player advances nobody and a final can be won by walkover —
        and a bracket with no live players refuses another round, offering
        tournament completion instead. Departed players keep the placement of
        the seat they reached: completing the walkover round stamps their
        elimination there (rewind clears and re-completion re-records it, and
        reinstates restore it), and bracket standings rank a walked-over
        seat-holder as eliminated in the round they were absent from
- [ ] Add late entry after round 1 (builds on section 3's organizer
      enrollment, which today is refused once the event leaves the
      registration lifecycle; players never self-join a started tournament)
  - [ ] Admit a late player by organizer override during the first phase
        only, with player capacity still applying
  - [ ] Record an opponent-less missed-round loss (zero game wins, required
        wins against) for every already-generated round, counting toward the
        player's own match points and GWP but excluded when their percentages
        feed opponents' tiebreakers (see CONTEXT.md "Missed Round")
- [x] Let organizers break and manually re-pair pairings before they are
      published to players (`model/manualPairing.ts`): break a generated
      pairing (deleting automatic bye/concession results with it — the same
      rule as Rewind — while entered results refuse the break), then pair a
      freed player against any other unpaired active player or award them a
      bye. Publishing pairings — and completing an unpublished round, which
      publishes them — is blocked while any active player lacks an opponent
      or a bye. Bracket rounds are excluded (pairings are structural).
- [x] Expand tournament-engine invariant tests
  - [x] Cover rematch avoidance and unavoidable-rematch behavior with deterministic cases
  - [x] Cover distinct byes, max-capacity Swiss standings, drops, cutoffs, and bracket rewinds
  - [x] Add randomized/generative tests across field sizes, seeds, rounds,
        drops, and brackets: `generative.convex.spec.ts` derives every
        scenario from fixed seeds via the engine's own PRNG (failures name
        the seed and shape). Pure layer: 150 in-memory Swiss tournaments
        against `buildSwissPairings` (partition, determinism, MTR bye
        choice, and zero rematches whenever one is provably avoidable —
        every paired player having met fewer than half the paired field
        guarantees a rematch-free matching exists) plus 300 random walkover
        plans against `planSingleEliminationPairings`. Full-stack layer:
        seven randomized tournaments driven through the real mutations
        (random field sizes/parities, round counts, best-of, mid-round drop
        concessions, between-round drops, top-8 cut, bracket walkovers,
        completion), checking every completed round against the
        `recomputeStatsThroughRound` oracle and playoff-advancement
        ordering. A deterministic coverage probe asserts the fixed seeds
        keep exercising drops, concessions, byes, draws, walkovers, and
        guaranteed-rematch-free rounds, so generator drift cannot silently
        drain coverage; validated by mutation-testing the bye rule (3 of 4
        tests catch it)

## 2. Phase structure and cuts

Cuts and brackets per the 2026-08-09 domain-modeling session (see `CONTEXT.md`
and `docs/adr/0001-bracket-walkover-to-scheduled-opponent.md`). Bracket
walkover behavior itself landed with the adjudication model in section 1.

- [x] Decouple cuts from phase types (reset the dev DB: a phase feeding the
      playoff now stores its cut explicitly — validation defaults a missing
      one to top-8 — and a single-elimination phase stores a null round count
      resolved from its entering field at start, like a dynamic Swiss phase)
  - [x] Allow a top-N or points-bar cut before any following phase type:
        `validPhaseInputs` accepts a cutoff on any phase with a following
        phase, defaulting to no cut between Swiss phases and a top-8 cut
        into single elimination, and progression applies the finished
        phase's configured cut uniformly through
        `cutoffPartitionForNextPhase` whatever the next phase's type
  - [x] Remove the special-cased top-8 cut in favor of an ordinary cut to 8:
        `topEightCutFromStandings`, the fixed 8-player/3-round constants,
        and the hardcoded "Quarterfinals" are gone — bracket seeding
        (`buildSingleEliminationPairings`, standard order for any power of
        two), round count (log2 of the field), and the first-round name all
        derive from the entering field (the interim playable-size gate this
        step added was itself removed by the bracket generalization below)
  - [x] Warn in the UI when a points-bar cut feeds a single-elimination
        phase: the phase editor keeps every cut option on a playoff-feeding
        phase (a phase newly put in front of a playoff is pre-filled with
        the default top-8, and an explicit "No cut" sends the whole
        surviving field into the bracket) and shows the
        unpredictable-bracket-size warning under a points bar or no cut
- [x] Generalize single-elimination brackets (CONTEXT.md "Bracket" is now
      implemented as written)
  - [x] Support any entry size of at least 2: the bracket is the smallest
        power of two that fits the field, standard-seeded
        (`buildSingleEliminationPairings`); the interim
        `isPlayableBracketSize` gate and the top-N-cut-into-playoff size
        restriction are gone, and a configured top-N cut no longer imposes a
        pre-start player floor — a short field just plays a short bracket
  - [x] Give the highest seeds first-round byes when the field is short
        instead of skipping the phase: unfilled lowest seats award their
        scheduled opponents — by construction the highest seeds — the same
        pairing-time Bye a walkover records
  - [x] Complete the tournament instead of playing a one-player phase: the
        next-phase entry shortfall is now uniformly "fewer than two entering
        players" whatever the phase type, refusing the round and offering
        completion
  - [x] Generalize bracket round names (Round of 16, Quarterfinals,
        Semifinals, Finals): named from the round's structural position —
        rounds remaining in the resolved bracket — so chained-walkover
        thinning can't misname a stage, with `Round of ${2^n}` above eight
        seats
- [x] Allow single elimination as the first phase, seeded from the tournament's
      random seed (reset the dev DB: bracket matches store a new field). The
      phase editor and backend accept a lone single-elimination phase — it must
      still be the final phase, so a bracket-first tournament is bracket-only —
      publishing and starting no longer require a Swiss phase, and
      startTournament pairs the bracket from `firstPhaseBracketSeedOrder`: the
      per-player `tiebreakRandom` already derived from the tournament seed, so
      a rewound round 1 re-pairs the identical draw. Landing it exposed and
      fixed a pre-existing bracket bug: seat winners were read back in table
      order, which hoists byes (no table) out of position and corrupted the
      bracket halves whenever a round had two or more byes (e.g. any six-player
      field — the top two seeds met in the semifinal); bracket matches now
      store an explicit `bracketSeat` that next-round pairing reads instead
- [x] Lower the 16-phase cap to 8 (the largest real events need 5–6, so 8
      leaves headroom): the shared `MAX_TOURNAMENT_PHASES` the phase editor
      already used is now the single definition — backend validation and the
      `phasesInOrder`/deletion read bounds import it — and the derived
      per-player history bound is now the explicit
      `MAX_MATCHES_PER_PLAYER = MAX_ROUNDS × MAX_TOURNAMENT_PHASES` (128,
      formerly a literal 256) shared by pairing history, standings recompute,
      match logs, and profile results

## 3. Player identity and admission

Guest enrollment, invitations, favorites, email, and payments need a player
identity that can exist without an authenticated account and can later be
claimed by one.

- [x] Separate tournament player identity from authenticated users (reset the
      dev DB: registrations now point at a new `participants` table; see
      CONTEXT.md "Participant"/"Guest"/"Claim" and ADR 0002)
  - [x] Add a player/participant entity with an optional linked user: the
        `participants` table carries at most one linked user, exactly one
        participant exists per account (created lazily by
        `ensureParticipantForUser`), and a Guest is a participant without one
  - [x] Store normalized contact email and organizer-provided display name:
        guest-only fields written by `createGuestParticipant` (the email
        normalized with the same rule as invitations);
        `participantPublicIdentity` resolves names through the user for
        linked participants and never exposes an email
  - [x] Point registrations at the participant identity: `participantId`
        replaces `userId` on registrations (indexes renamed to match), every
        user-keyed read hops through `participantForUser`, and seeded test
        players are now Guests — the synthetic test users are gone
  - [x] Define how a guest participant is claimed or merged after account
        creation (ADR 0002): claiming is automatic at sign-in by
        verified-email match, mirroring invitation acceptance —
        registrations repoint and the guest row is deleted — and merges are
        whole-guest-or-nothing: a guest sharing a tournament with the
        claiming participant stays unclaimed, preserving the
        one-registration-per-participant-per-tournament invariant; covered
        by `participants.convex.spec.ts`
- [ ] Centralize registration and participation state transitions
  - [x] Keep entry status separate from competitive participation status
  - [x] Reserve pending, waitlisted, confirmed, cancelled, and rejected entry states
  - [x] Reserve active, dropped, eliminated, and disqualified participation states
  - [x] Add write-side transitions and authorization for every supported
        state (2026-08-19): the roster verb module now covers the review-flow
        entry states — organizer-only approveEntry (pending/waitlisted/
        rejected → confirmed, capacity-guarded, seat counter maintained;
        waitlisted approval doubles as manual promotion and rejected approval
        is the sanctioned rejection reversal), rejectEntry (declines an
        application, removes a confirmed player and releases the seat, or
        bars a cancelled row from re-entering — every arm lands in
        "rejected", which registerSelf refuses to re-enter), waitlistEntry
        (pending → waitlisted), and player withdrawal of a pending/waitlisted
        application through cancelEntry — each routed on effect projections
        (model/registrations.ts), with typed audit events
        (registration_approved/rejected record previousEntryStatus) and thin
        organizer endpoints; covered by entryTransitions.convex.spec.ts.
        The way in landed with the approval admission mode below
        (registerSelf files pending applications when
        registrationRequiresApproval is on); the "disqualified" participation
        state stays writer-less until section 5's judge DQ action by design
  - [ ] Define capacity, decklist, payment, cancellation, and refund guards
        for each transition (capacity guards landed with the transitions —
        every seat-taking path routes through requireCapacityAvailable — and
        cancellation is lifecycle-gated; payment and refund guards landed
        with section 9's order/refund records — paid seats move only through
        the payment webhook and exits settle their orders; decklist guards
        remain blocked on section 6's publication/submission policy work)
- [ ] Add invite-only admission modes
  - [x] Support public, unlisted, and private tournament visibility
  - [x] Make event public codes random (2026-10-13, CONTEXT.md "Public
        Code"; PR #51): tournaments and conventions get a 6-character Crockford
        base32 code minted through a uniqueness check instead of a
        sequential counter, so unlisted events can't be walked by code.
        It shares the invite code's alphabet and normalizer
        (`model/codes.ts`), and `/join/<code>` takes either kind
        (`resolveJoinCode`, told apart by length; a public code resolves
        only for viewers who could open the event page). User codes stay
        numeric, and a private event's invite grant stays separately
        revocable (regenerate or disable) without touching the event's
        public code. The dev DB was reset for the string `publicCode` and
        required `seed` on 2026-11-04
  - [x] Add the organizer's join QR code on web (2026-10-13, CONTEXT.md
        "Join QR"; PR #51): the settings share card follows visibility — a public
        or unlisted event shares `/join/<public code>`, a private one its
        invite link — and both it and the Overview open a QR dialog with
        PNG download and a print sheet (`qrcode.react`). The QR code shows
        only while registration is open. Regenerating or disabling the
        invite link now asks for confirmation, since it kills printed codes
        too; covered by `e2e/invite-links.spec.ts`
  - [x] Add join-by-link/code invitations (2026-08-22, CONTEXT.md "Invite
        Link"): one shared join code per tournament in its own
        `tournamentInvites` table — a bearer secret, kept off the tournament
        document because player queries return that verbatim — granting view
        (`getPublicTournament`) and registration (`registerSelf`) access
        whatever the visibility, so it is the way into a private event.
        Codes are Crockford base32 (lookalike-tolerant normalization, so a
        code read aloud survives typing) minted/rotated/disabled from a
        settings-page card; `/join/<code>` resolves and forwards to the
        event page with `?invite=` riding through sign-in redirects. The
        grant never overrides entry decisions (a rejected row stays
        rejected), capacity, lifecycle gates, or setup secrecy; covered by
        `inviteLinks.convex.spec.ts`
  - [x] Add organizer approval and rejection of pending registrations
        (2026-08-19): a pre-start `registrationRequiresApproval` toggle in
        tournament settings (reset the dev DB — required field on
        tournaments) makes registerSelf file a "pending" application — no
        seat taken, no participation status, `registration_requested` audit
        event, capacity still gating, and a cancelled row re-registering
        re-enters as pending rather than retaking its seat. Organizers
        review from the Registrations tab: approve / move to waitlist /
        reject actions on the row menu, rendered from server-computed effect
        projections with per-arm reject confirmation wording. Players see
        pending/waitlisted/rejected states on the event page (with
        application withdrawal), a "Request to register" button under
        approval mode, and their open applications in the home listing with
        a status badge (listMyTournaments now includes pending/waitlisted
        rows)
  - [x] Surface pending applications for organizer review (2026-09-16): the
        Registrations tab's toolbar gains a single-select status chip
        (Pending review / Waitlisted / Confirmed / Active / Eliminated /
        Dropped / Disqualified / Cancelled / Rejected) applied server-side —
        `listRegistrationPage` walks the
        `by_tournamentId_and_entryStatus_and_awaitingReview` index under an
        entry-status filter (creation order, so a filtered list pages
        newest-first like the unfiltered one) and the existing
        `by_tournamentId_and_entryStatus_and_participationStatus` index
        under a participation status's prefix, and `searchRegistrations`
        narrows on the same columns (now search-index filter fields), so the
        filter sees the whole history rather than the pages loaded so far
        and composes with the search box. On paid events a Payment chip
        narrows both walks on `tournamentRegistrations.paymentStatus`, a
        mirror of the newest order's status that every order write keeps in
        step, and that a row entering or leaving the confirmed state
        re-derives (`syncRegistrationPaymentStatus`,
        `syncRegistrationPaymentStatusFor`; the roster's Payment column
        reads it too, never the orders table). A confirmed seat whose
        newest order closed unpaid (canceled or expired) mirrors nothing,
        since the seat was taken another way and owes nothing for that
        order — a comped seat, an enrolled or restored entry whose checkout
        lapsed. A search-index filter field, and a row-budgeted post-filter
        on the list (reset the dev DB: a registration whose order predates
        the mirror shows no payment state and never matches the chip until
        that order is next written or the row crosses the confirmed
        boundary). "Pending review" is the review
        queue (CONTEXT.md "Review Queue"): a pending row carries
        `awaitingReview` only until the organizer decides it, so an approved
        entry awaiting its payment on a paid event — or one filed by a
        direct checkout — is pending without being review work. The row
        menu's approve/waitlist/reject actions act in place, and each filter
        has its own empty state. The Registrations tab in the manager subnav
        carries a count of applications awaiting a decision
        (`getPendingReviewCount`, capped at 99+, zero once the tournament
        leaves the registration lifecycle and the decisions with it), so
        review work is visible from anywhere in the manager
  - [x] Bar re-entry to a private event after organizer removal
        (launch-blocking, completed 2026-08-19): rejecting is the bar — the
        roster menu's "Reject registration" acts on a cancelled row (closing
        the standing invitation registerSelf honors), and on pending/
        waitlisted/confirmed rows, every arm landing in "rejected", which
        registerSelf refuses until an organizer approves the row again;
        write side and re-entry refusal spec-covered in
        entryTransitions.convex.spec.ts
  - [ ] Add waitlist promotion (manual promotion exists — the organizer's
        approve action confirms a waitlisted row, capacity-guarded; this
        item is the automatic/ordered promotion when a seat frees, and
        should also revisit registerSelf's full-event behavior, which today
        refuses applications at capacity instead of auto-waitlisting them)
- [x] Enroll players as guests or by email without requiring an account
      (2026-10-27, CONTEXT.md "Enrollment", "Awaiting Player Details", ADR
      0002 amendment): the Registrations tab offers two actions — "Enroll
      player" (email only) and "Add guest" (name only) — both seating a
      confirmed, capacity-counted entry exempt from in-app entry payment
      (`entryFeeExempt` persists through Claims and organizer
      reinstatements). An email enrollment always seats the Guest keyed by
      the address, never linking an existing account, so every email
      enrollment starts in one organizer-visible state, "Awaiting player
      details"; the Claim links the account and stamps the account's name
      onto the entry — it runs on every authenticated mutation, and both
      apps run the sign-in at the root as soon as the viewer is verified
      (`useEnsureUserRow` in `@paper-pairings/core`) and again when a Guest
      appears under the viewer's email while the app stays open
      (`hasUnclaimedGuest`), so opening the app suffices and an enrollment
      made while it is open is claimed as it lands. A player's own
      registration or checkout into an event where a Guest carrying their
      email holds an entry takes that entry over (the targeted Claim,
      `claimGuestEntryInTournament`), never a second seat, and a confirmed
      entry handed over that way is answered as the registration by both
      — the checkout reports `registered` and takes no payment. "Continue as guest" names an unresolved entry for one event
      (`organizerNamed`, honored by the re-stamp and by the Claim on a live
      entry; dropped for the account's name once an account holder's entry
      is cancelled or re-entered), keeping its seat, history, fee treatment,
      and contact email. Starting
      the event and seating a player meeting refuse while any active entrant
      has no name; the organizer board lists them with the resolutions. An
      account always has a name (`users.name` is required: a first sign-in
      without one is refused, a later one keeps the stored name), so only
      an email enrollment is ever nameless. A
      cancelled row for the identity (the account's or the Guest's) is
      re-entered; pending/waitlisted/rejected rows are refused toward the
      review verbs. Metered by the `enrollPlayer` bucket. Covered by
      `guestEnrollment.convex.spec.ts`, the names gate in
      `tournaments-player-identity.convex.spec.ts`, and the web dialogs in
      `enrollment-dialogs.test.tsx`
- [ ] Personal tournament invitations — an emailed invite a player accepts,
      or a pay-later enrollment — are deliberately deferred and are not part
      of the enrollment feature above; organizers share the tournament's
      Invite Link themselves. Revisit only with the transactional-email
      layer in section 7
- [ ] Enrollment council follow-ups (2026-11-04; hardening, not defects):
      gate the Claim, invitation acceptance, and the `hasUnclaimedGuest`
      signal on `identity.emailVerified` once the Clerk JWT template is
      confirmed to carry it; answer a Register or checkout that lands just
      after the app's own sign-in claimed the seat as the registration
      rather than "Already registered"; skip the sign-in's users-row patch
      when nothing changed, now that the sign-in runs on every app open.
      (The double-seat path left by the all-or-nothing Claim is closed:
      `heldOrClaimedEntry` refuses to re-enter an account's cancelled row
      while a Guest under the account's email holds a live row in the
      event, for registerSelf and the entry checkout alike.)
- [ ] Persist organizer favorite players across tournaments
  - [ ] Decide whether favorites are scoped to an organizer or the organization
  - [ ] Filter pairings, registrations, and standings by favorites

## 4. Event hierarchy and conventions

Model conventions and other umbrella events as first-class containers instead
of overloading a tournament or relying on naming conventions. Tournaments must
remain usable on their own and keep their own registration, phases, rounds,
results, and standings. Core landed (see ADRs 0003 and 0004): the `conventions` entity
with badge registration and badge fees through the shared payment engine,
parent-child attach/detach, configurable badge gating for child-event
registration, the organizer convention workspace, and the public landing page.

- [x] Add an umbrella-event entity that can contain multiple tournaments
  - [x] Support conventions without allowing recursive nesting (a generic
        umbrella-event kind discriminator is deferred; pre-production makes
        adding one later free)
  - [x] Store the container's name, description, date range, visibility, and
        lifecycle (timezone deferred — nothing app-wide is timezone-aware
        yet; epoch ms rendered browser-local, same as tournaments)
  - [x] Allow a tournament to belong to zero or one umbrella event
  - [x] Define cancellation and deletion behavior without silently changing
        completed child events (cancel leaves children attached and running;
        delete force-detaches and preserves them)
- [ ] Add convention-level event management
  - [x] Create a child tournament from a convention and attach or detach an
        existing tournament with permission checks (move = detach + attach)
  - [ ] Share convention staff with child tournaments while allowing event-specific roles and overrides
  - [ ] Reuse convention venue and schedule defaults while allowing each child event to override them
  - [ ] Detect obvious scheduling conflicts when the same player registers for overlapping child events
- [x] Add convention organizer and public surfaces
  - [x] Show all child events with their registration state, schedule, capacity, and lifecycle status
  - [x] Add convention-scoped navigation and an organizer overview across all child events
  - [x] Add a public convention landing page with schedule and event discovery
  - [x] Preserve direct tournament URLs and standalone discovery for child events
- [x] Add composable convention ticket types and door sales (ADR 0004,
      merged in PR #23): per-type price/capacity, sale and admission windows,
      included child events, and ticket selection at registration/Checkout.
      The convention stays in `registration` throughout its live run until
      completion or cancellation; there is no separate start action.
- [ ] Convention follow-ups deliberately out of v1
  - [ ] Badge approval/waitlist flows (the shared entry-status validator
        already admits the states)
  - [ ] Convention invite links for private conventions
  - [ ] Guest badge enrollment
  - [ ] Multiple passes per participant, pass upgrades, and per-type refund
        deadlines, if needed; the current model allows one badge per participant
- [ ] Decide whether convention deletion should preserve badge history as
      tournament deletion now preserves player history. The current
      convention delete checks settled payments and detaches children, but
      does not apply the tournament's test-event/unpublished-empty gate.

## 5. Judge operations and player conduct

Give judges a focused event-day workspace and model judge actions as durable,
auditable domain records. Operational table state must remain separate from a
match result so judge tooling cannot accidentally change standings.

- [ ] Add judge and head-judge roles with explicit permissions
  - [ ] Assign staff to one tournament, selected tournaments, or every child event in a convention
  - [ ] Separate access to live match operations, private notes, infraction history, and disqualification actions
- [ ] Build a mobile-friendly judge workspace
  - [ ] Show the active round, timer, tables, outstanding results, judge calls, and recently updated matches
  - [ ] Search by player, table, or match and filter to items requiring judge attention
  - [ ] Keep common event-day actions usable without entering the full organizer interface
- [ ] Add per-match time extensions
  - [ ] Record the duration, reason, issuing judge, and timestamp for every extension
  - [ ] Show the cumulative extension and adjusted match deadline to judges and affected players
  - [ ] Audit edits or revocations instead of replacing the original action silently
- [ ] Add structured player warnings and infractions
  - [ ] Anchor conduct records to the durable participant identity so history survives individual registrations
  - [ ] Record the player, tournament, optional match/round/table, category, severity, penalty, notes, judge, and timestamp
  - [ ] Support warnings that do not alter a result and penalties that flow through the normalized adjudication model
  - [ ] Show an authorized judge the player's history within the current event and across prior events
  - [ ] Define the organization/convention boundary within which cross-event history may be viewed
  - [ ] Add append-only corrections, privacy controls, retention rules, and access auditing for sensitive conduct history
- [ ] Add no-show and forfeit adjudication actions (moved from section 1,
      2026-08-13: judge calls, not routine result entry; until they land an
      organizer covers a forfeit by manually entering the match result)
  - [ ] A no-show defaults to also dropping the absent player (staff can
        keep them in); both players absent is a double match loss
  - [ ] Record a bracket double no-show as a double match loss; the landed
        walkover machinery (ADR 0001) then advances nobody from that seat
        pair and offers completion when no live players remain
- [ ] Complete the DQ workflow (MTR/IPG-aligned — see `CONTEXT.md`; moved
      from section 1, 2026-08-13, alongside the other judge adjudications)
  - [ ] Remove DQ'd players from standings entirely so every lower-ranked player advances one place (the old mask-as-drop machinery is already deleted; player surfaces report a disqualification as-is until this lands)
  - [ ] Keep a DQ'd player's completed matches on record and feeding former opponents' tiebreakers, with the tournament staying on their profile without a placement
  - [ ] Add an authorized DQ action and participation-state transition
  - [ ] Record each DQ as a typed, staff-only audit event with the actor and affected player
  - [ ] Apply the DQ's match consequence: the disqualified player loses
        their current match when it is unresolved (IPG 1.1); an
        already-reported result is never flipped, and the DQ action exists
        only while the tournament is in progress
- [ ] Add ghost-match handling for unreported matches whose players have left the table
  - [ ] Track ghost status, reporting judge, timestamp, and notes independently from result state
  - [ ] Remove ghost matches from active-table and routine result-reminder views and move them to a judge exception queue
  - [ ] Keep the result unresolved and block ordinary round completion until staff report or adjudicate it; never invent a result or change standings from ghost status alone
  - [ ] Let authorized staff reopen the table state or resolve the match through normal reporting, forfeit, no-show, or DQ adjudication
- [ ] Add authorization and invariant tests for judge actions, cross-event history, time extensions, and ghost matches

## 6. Publication, location, and discovery

Tournament discoverability, participant release, and public publishing are
separate concerns. Model them explicitly before adding more boolean settings.

- [ ] Add artifact publication policies per tournament
  - [x] Keep tournament visibility separate from lifecycle
  - [x] Store per-round pairing release state
  - [x] Support manual or automatic release of newly generated pairings to players
  - [ ] Configure organizer-only, participant, or public audience per artifact
  - [ ] Configure manual, during-event, after-event, or never timing for standings, pairings, and decklists
  - [ ] Enforce publication policy consistently in public, player, and organizer queries
  - [ ] Project organizer-only fields away from public tournament reads:
        `getPublicTournament` and `listPublicChildEvents` return the
        tournament document whole, so the required pairing `seed` is public
        and lets a player compute every `tiebreakRandom` and the bracket
        shuffle
- [ ] Add structured paper-event location data
  - [ ] Store venue name and structured address fields
  - [ ] Store timezone and optional normalized place/coordinate data
  - [ ] Show the location on public and player-facing event surfaces
  - [ ] Add indexes/read models needed for later location filtering
- [ ] Add upcoming-tournament filters
  - [x] Format (Format chip on the public schedule and organizer tables)
  - [x] Date range (Start date chip under More filters)
  - [ ] Location
- [ ] Finish decklist submission and publishing
  - [x] Store one structured decklist per confirmed registration
  - [x] Provide player decklist create/edit/read flows
  - [ ] Add an organizer deck-check view — the backend query
        (`getDecklistForRegistration`) exists but no client surface
        consumes it
  - [x] Lock submission when registration closes and retain submitted lists
  - [x] Validate structural bounds and normalize duplicate card rows server-side
  - [x] Audit initial submissions and resubmissions
  - [ ] Add a client pasted-text importer (the raw-text half landed:
        submissions already store bounded `rawText` server-side; only the
        client parser/import UI is missing)
  - [ ] Add format-aware card-count and legality validation with clear warnings/errors
  - [ ] Apply the tournament's decklist publication policy

## 7. Domain events and communications

Use a durable, idempotent domain-event/outbox layer rather than treating the
organizer audit log as a delivery queue. Audit, in-app notifications, email,
push, analytics, and monitoring should be independent consumers.

- [ ] Add a durable domain-event/outbox model for important tournament transitions
- [ ] Emit events for registration changes, event start, pairing publication, round start, timer start, outstanding-result reminders, result changes, and cancellation
- [ ] Add idempotent delivery state and retry handling for external providers
- [ ] Add in-app player-controller notifications for event/round transitions and outstanding player actions
- [ ] Add transactional email
  - [ ] Staff invite emails
  - [ ] Tournament invitation emails (deferred with personal tournament
        invitations, section 3; the shareable Invite Link stands in)
  - [ ] Registration confirmation and status-change emails
  - [ ] Cancellation and refund emails
- [ ] Add native push notification infrastructure
  - [ ] Register installations and device tokens, handle permission state, and retire invalid tokens
  - [ ] Deep-link notifications to the relevant convention, tournament, round, match, or result-entry screen
  - [ ] Track delivery attempts separately from the domain event and make fan-out idempotent
- [ ] Add native push notifications for event start, published round pairings, and round start
  - [ ] Include the player's table and opponent in pairing notifications when publication policy permits it
- [ ] Add configurable reminders for a player to submit an outstanding match result
  - [ ] Schedule reminders from the round/match policy rather than a hardcoded delay
  - [ ] Cancel or suppress reminders when the result is reported, the match is adjudicated, or the match is marked as a ghost match
  - [ ] Prevent duplicate and stale notifications across retries, corrections, round rewinds, and device installations
- [ ] Add per-user, per-event notification preferences and delivery-channel controls
  - [ ] Respect timezone, quiet-hours, and opt-out settings for reminders while preserving required operational notices

## 8. Event-day outputs and client parity

- [ ] Add printable outputs
  - [ ] Pairings by table
  - [ ] Pairings by player name
  - [ ] Result slips
  - [ ] Standings
- [ ] Complete native player-controller parity
  - [x] Show current match and player meetings
  - [ ] Custom app bar (event name + `RoundTimerPill`; the native stack
        header wraps items in an iOS 26 glass capsule, so the timer is
        unmounted until then) and tab bar
  - [ ] Standings (removed from the match page; return them behind the
        planned tab bar)
  - [x] Report a result (the scoreboard from the Figma "Match result
        explorations" page: half-numeral tap targets, draws behind a prompt,
        hold to submit; mutation errors surface via `mutationErrorMessage`
        from `@paper-pairings/core` so rate-limited rejections get the
        retry-later treatment)
  - [ ] Drop from the event
  - [ ] Show match history
  - [ ] Submit and view decklists
- [ ] Refine the native experience
  - [x] Handle authentication and primary loading states
  - [x] Respect native safe areas
  - [ ] Complete the visual/design pass
  - [ ] Add robust error and empty states across every workflow
  - [ ] Define and implement offline/read-cache tolerance
  - [ ] Fix or drop the native app's web target: `expo export --platform web`
        fails in the router's static render (`requireNativeComponent` is not
        a function), so the native build script and the CI smoke check export
        ios+android only
- [ ] Join events from the native app (`docs/plans/qr-join.md`; its PR 0,
      PR 1, and PR 2a labels are plan stages, not GitHub PR numbers)
  - [x] Add the native join screen for free and approval-mode events
        (2026-10-13; PR #51): `/join/<code>` resolves either code kind
        (`useJoinCode`), shows the event summary and the one action
        `deriveJoinAction` picks, and registers or files the application in
        the app; paid entry hands off to the web event page
        (`EXPO_PUBLIC_WEB_ORIGIN`). The event page's not-registered dead
        end now renders the same panel, and the native event route is
        `tournaments/[code]` to match the web. `@paper-pairings/shared/app-links`
        parses join URLs and bare codes for the scanner, and the client
        clock and `useStableQuery` moved into core
  - [x] Add the native QR scanner (`expo-camera`; needed a dev-client
        rebuild; the camera itself still needs physical devices). PR #51:
        `/scan`, opened from home's header and its empty state,
        with the viewfinder, torch, camera permission states, haptics, and
        "Type a code instead", all through one pure intake
        (`@paper-pairings/shared/scan-intake`) that never opens a foreign
        URL. Its simulator-reachable paths passed in the Maestro suite at
        `ba289b1` against the personal dev deployment, 2026-11-04, on the
        third full run (the first two each lost one flow to the sign-in
        failure below, and each such flow passed on rerun)
        ([record](docs/delivery-status.md)); the camera itself is
        unverified until the physical runs below
  - [ ] Offer the targeted Claim from the join panel: when a Guest under the
        viewer's email holds the seat but the viewer's own row is absent and
        the event is full, closed, or badge-gated, both panels show the gate
        while registerSelf would hand the seat over first. Needs a
        viewer-scoped signal from the backend. Reachable only through an
        unclaimable Guest (a collision elsewhere after an email change), so
        deferred from the council review
  - [ ] Give the join derivation the private-event grant: an organizing-team
        member with no row who opens their own private event's public code
        is offered Register, which `registerSelf` refuses ("Tournament is
        not open for registration"). Needs `visibility` and an invite-grant
        flag as derivation inputs so the panel reads "invite required"
        instead. Organizer-only, and the server already refuses clearly, so
        deferred from the third council review
  - [x] Move the web registration panel onto the shared join-state
        derivation, preserving coverage for each registration and payment
        state (the plan's PR 3). PR #51:
        `deriveRegistrationAction` in core decides the web panel,
        `deriveJoinAction` is its native projection, and
        `tournament-public-page.test.tsx` pins every panel branch as a
        characterization row. At `ed73394`, against the personal dev
        deployment on 2026-11-04, the registration e2e specs passed and the
        native Maestro suite passed on rerun (the first run was 16/17, one
        flow lost to the sign-in failure below)
        ([record](docs/delivery-status.md))
  - [ ] Offer "Open in the app" on the mobile web event page reached
        through `/join`, until universal links exist
  - [ ] Pay in the app: Stripe Checkout in `expo-web-browser`, returning
        through a `paperpairings://` deep link, with the payment-status
        dispatch shared from core
  - [ ] Claim `/join/*` as universal links (blocked on the custom domain,
        the Apple Team ID, and the Android signing cert)
  - [ ] Run device E2E with Maestro (EAS Workflows supports it), so the
        scanner and payment device matrix stops being manual. Partial, in
        PR #51: `apps/native/e2e/` runs the PR 2a deep-link matrix and the
        scanner's simulator-reachable paths, seeded on the dev deployment
        and signed in through a dev-only ticket link
    - [x] iOS simulator deep-link matrix: passed 17/17 on an iPhone 17 Pro
          simulator (iOS 26.5) at `2b3d36a` against the personal dev
          deployment, 2026-11-04, and again at `5a6cf8e` (the third council
          round's fixes, PR #51), 2026-11-08, across a full run and reruns of
          the flows the sign-in failure below took
          ([record](docs/delivery-status.md))
    - [ ] Android emulator run (the recorded machine has no Android SDK)
    - [ ] Diagnose the intermittent sign-in failure: after the dev-only
          ticket link, home sometimes stays on the auth gate's unverified
          state ("We couldn't verify your account"), or signed out under a
          "[ClerkProvider] Failed to sync native client state: No session
          was found" toast naming the session the link just ended, through
          the flow's 60-second wait. Seen 3 times in about 100 flow runs
          across the 2026-11-04 records and 3 times in 25 on 2026-11-08
          (and again in the fourth round's scanner reruns), in a different
          flow each time within a day — `21-scan-typed` on both days — and
          each passed on rerun
          ([record](docs/delivery-status.md)). The Clerk provider's native
          state sync racing the link's sign-out and ticket sign-in, or a
          token race between Clerk's `setActive` and Convex validating the
          new session's token; the link is handled in
          `apps/native/src/app/dev/[action].tsx`. A third suspect is the
          flows' own wait: `subflows/signed-in.yaml` waits for "Your
          tournaments", which the previous session's home may already show
          before the link screen is pushed, so a flow can run on during the
          session switch; a marker the dev route leaves on home would close
          that
    - [x] iOS simulator scanner flows (PR 2b): the entry points, the
          permission explainer and refused-state copy, and typed codes
          (a foreign link's toast, a Public Code, a dashed invite, back to
          the scanner) passed with the 17 join flows, 21/21 on an iPhone 17
          Pro simulator (iOS 26.5) at `ba289b1` on `qr/native-scanner`,
          2026-11-04, and again at `5a6cf8e` (PR #51), 2026-11-08, across a
          full run and reruns of the flows the sign-in failure took. After
          the fourth round's scanner and runner changes (`39be9c9`) flows
          18 to 20 passed again, and `21-scan-typed` passed once its flow
          waited for the keyboard layout before tapping the field — the
          tap had been landing on the keyboard and typing a stray "T"
          ([record](docs/delivery-status.md))
    - [ ] Physical iPhone and Android runs, adding what a simulator can't
          reach: scanning a real Join QR and a foreign QR code, the scan
          lock and re-arm, the camera and torch going off under the join
          screen, the torch, haptics, and granting camera access in
          Settings after a refusal (PR 2b), and the payment round trip
          (PR 4)
    - [ ] Flows the suite still lacks: one that taps Register and asserts
          the seated event (no flow completes a direct registration;
          `10-private-invite` stops at the button, so a registration that
          dropped its `inviteCode` would pass), the native signed-out "Sign
          in to view this event" state for a private event's public code,
          and "Open the event" from a join screen the scanner opened, then
          back to home. Each needs a dedicated fixture or step and a
          simulator run to validate; deferred from the third council review
    - [ ] Run the suite in CI or EAS Workflows
- [ ] Add real safe-area support to the web app chrome; ship all parts together
  - [ ] Add `viewport-fit=cover` to the root viewport meta in `apps/web/src/routes/__root.tsx`
  - [ ] Add bottom safe-area padding to SiteShell's fixed bottom-bar chrome
  - [ ] Size SiteShell content clearance to footer height plus the bottom inset
  - [ ] Add top safe-area padding to sticky top bars
  - [ ] Audit every web page in portrait and landscape before enabling the site-wide viewport change

## 9. Payments

Stripe Connect implementation is merged; deployment verification is tracked
separately below and in [delivery status](docs/delivery-status.md). See
`docs/payments.md` and the
`payments.structure.convex.spec.ts` invariants. Architecture: Accounts v2
recipient-configured connected accounts (express dashboard, platform-owned
fees and losses — the legacy Standard/Express account types are deprecated in
favor of these explicit v2 dimensions) with separate charges and transfers:
players pay the platform via Stripe-hosted Checkout, funds hold through the
refund window, and entry fees transfer to the organization when the
tournament completes. Players absorb the platform fee (default 5%) plus a
grossed-up processing estimate (`@paper-pairings/shared/payment-fees`). The
organizer's share is the entry cost per paid seat before absorbed refund fees.

- [x] Decide platform versus marketplace payment architecture
  - [x] Evaluate organizer payout account shapes: Accounts v2 recipient
        configuration with the express dashboard replaces the old
        Standard-vs-Express question; OAuth-linking existing Stripe accounts
        is a deprecated v1 pattern and out of scope
  - [x] Record ownership: the platform is merchant of record and owns Stripe
        fees, disputes (record-and-exclude in v1), and negative-balance
        liability; refunds are automatic per the rules below; tax is out of
        scope pre-launch
- [x] Add entry-fee settings to tournaments: `entryFeeCents` +
      `refundDeadline`, pre-start editable from the settings card with a live
      player-price breakdown, requiring a payouts-ready connection, frozen
      once any order exists
- [x] Add separate order, payment, and refund records with idempotent webhook
      processing: paymentOrders/paymentRefunds/eventPayouts/
      payoutTransfers plus the processed-event table; fulfillment happens
      only in the signed `/stripe/events` httpAction, which re-checks
      capacity at payment time and auto-refunds when the seat is gone
- [x] Add paid registration and organizer payout onboarding: Checkout-based
      registration (approval-mode events charge after approval), Connect
      onboarding from the organization page, and the completion payout sweep
      (per-order transfers with idempotency keys, greedy absorbed-fee
      deduction, live capability re-check, owner-retriable when blocked)
- [x] Add cancellation/drop refund rules before tournament start: a player's
      first pre-deadline cancel refunds in full (organizer absorbs the
      processing estimate from their payout); a repeat cancel refunds entry
      only; organizer removals always refund in full without flagging;
      cancelling the tournament refunds everyone (withheld repeat-drop fees
      included); mid-event drops never refund
- [x] Reconcile payment state with registration transitions without
      overloading registration status: no new entry statuses — "awaiting
      payment" is a pending entry plus a live order, seats move only through
      the webhook, and hard deletion refuses while money is unsettled
- [x] Record the historical Stripe sandbox exercise (2026-10-04):
      hosted Connect onboarding → thin-event status sync → paid Checkout
      registrations fulfilled by webhook → player-cancel full refund with the
      organizer-absorbed fee → completion payout sweep (two transfers,
      `source_transaction`-anchored, absorbed fee deducted). Surfaced and
      fixed two account-creation requirements (`contact_email`,
      `identity.country`) and the Accounts v2 restricted-key permission.
      The record does not identify a deployed SHA or target environment and
      predates the refund recovery fixes; it is not current-release or
      live-mode verification.
- [x] Implement the signed v2 thin-event endpoint and capability sync
      (`/stripe/account-events`, `STRIPE_ACCOUNT_WEBHOOK_SECRET`) for
      `v2.core.account[configuration.recipient].capability_status_updated`
      and `v2.core.account[requirements].updated` so connected-account
      status stays fresh without polling; the payout still re-checks live
      before every transfer
- [x] Merge bounded refund execution and recovery (PR #40), including
      parked/processing lists, webhook reconciliation, and owner status checks;
      merge start/cancel withdrawal of unpaid pending entries (PR #42).
      See `docs/refund-recovery.md` for the contract and operator runbook.
- [ ] Verify the current release against a named Stripe sandbox and deployed
      SHA. Cover direct and approval-mode tournament entry, convention ticket
      purchase, both webhook endpoints, cancel/refund, parked-refund recovery,
      and completion payout. Record redelivery outcomes and provider/event
      references in `docs/delivery-status.md` without credentials.
- [ ] Verify live-mode configuration before accepting real payments: account
      readiness, restricted-key permissions, both endpoint subscriptions and
      signing secrets, HTTPS return origin, and the release revision. A sandbox
      pass alone does not close this gate. The app remains pre-production.
- [x] Give organizers Express Dashboard access through in-app single-use
      login links (`createDashboardLink`)
- [ ] Build the dispute workflow beyond v1's record-and-exclude (evidence
      submission, post-payout clawback via transfer reversals)
- [ ] Reconcile the estimated processing fee against Stripe's actual
      per-charge fee (balance transactions) before scale — international
      cards cost more than the default 2.9% + 30¢ estimate
- [x] Guard the hardcoded US account country (2026-10-05): a first connect
      must name a country in `SUPPORTED_STRIPE_COUNTRIES` (US only) or it
      is refused before any Stripe call; the payments card says so and
      collects an explicit US-based acknowledgement; the country is stored
      on `organizationStripeAccounts`
- [ ] Cross-border payouts: let organizations outside the US connect and be
      paid (players keep paying in USD). Small–medium: add a country picker
      limited to Stripe's cross-border-payout recipient countries, widen
      `SUPPORTED_STRIPE_COUNTRIES`, and confirm against a sandbox that a
      non-US recipient account with `dashboard: "express"` accepts USD
      transfers (Stripe converts at payout; decide who bears the ~1% FX
      fee). Entry fees stay USD-denominated for the organizer.
- [ ] Local-currency pricing: let an event charge players in the
      organization's currency. Medium–large and separate from the above:
      per-currency Stripe fee estimates and charge minimums in
      `payment-fees` (today's 2.9% + 30¢ and $0.50 floor are US card
      rates), zero-decimal currencies, a currency on entry-fee settings and
      orders flowing into Checkout `price_data.currency`, transfers in a
      currency the platform balance holds (or accepting conversion),
      per-currency payout sums, and every `formatCents` call site
      (`apps/web/src/lib/money.ts` and its native twin
      `apps/native/src/lib/format.ts` are hardcoded to en-US/USD).
- [ ] Let `createEntryCheckout` return to the native app: a
      `returnTo: 'app'` enum that points Checkout's success and cancel URLs
      at a web bounce page linking back into the app
      (`docs/plans/qr-join.md` PR 4)

## 10. Design system and platform polish

The web design foundation is merged: PR #32 supplied the rebrand, theme,
and organizer Overview; PR #33 the shared page layout and workspace restyle;
PR #34 the Radix-based component styling. The Figma ledger records design
work, not deployment or accessibility verification. Current conventions are
in [the design guide](docs/design/README.md).

- [x] Establish the shared web design foundation
  - [x] Share player-facing site chrome through SiteShell
  - [x] Share workspace headers, table states, result badges, and common interaction components
  - [x] Define semantic color, Geist type, radius, and elevation tokens in
        `apps/web/src/styles/app.css`, with light/dark/system theme support
  - [x] Standardize page gutters, reading width, section spacing, and table
        controls through shared components
  - [x] Restyle core organizer and web player workflows using the shared system
- [ ] Finish design guidance and verification
  - [x] Document the merged composition patterns and accessibility expectations
        in `docs/design/README.md`
  - [ ] Consolidate motion durations/easing and audit reduced-motion behavior;
        individual animations and reduced-motion rules already exist
  - [ ] Complete keyboard, focus, screen-reader, contrast, and touch-target
        audits across organizer and player workflows in both themes
  - [ ] Verify responsive layouts and record viewport/theme coverage against
        the release revision; web safe-area work remains in section 8
- [ ] Add bundle budgets and performance regression checks

## Completed foundations

### Delivery guardrails

- [x] Browser E2E suite: organizer happy path, corrections + rewind + drop,
      mid-round drop concession, invite links (`apps/web/e2e/README.md`)
- [x] Sentry wired into the web and native apps behind optional DSN env vars
      (`docs/error-monitoring.md`)
- [x] Per-identity rate limiting on the self-serve mutation surface,
      structurally bounded queries, and friendly retry-later errors
      (`docs/rate-limiting.md`)
- [x] Committed `.env.example` contracts and typed Convex env declarations
      via `defineApp({ env })` (`docs/environment.md`)
- [x] CI on pull requests (against the merge ref) and pushes to `main`, with
      four jobs: test, checks (single-copy
      guard for react/react-dom/react-native/convex via
      `scripts/check-single-version.js`, lint, typecheck, format), native
      smoke export, and production web build. The local `pnpm check` runs
      dependency, format, type, lint, and test checks; it does not build or
      run browser E2E. The CI web artifact has no runtime credentials and
      is not deployed. Expo's
      `expo install --check` runs weekly in `expo-drift.yml` and files an
      issue, since it tracks npm release state rather than the commit.
- [x] Backend ESLint at zero warnings
- [x] Toolchain pins: Node 24 LTS, pnpm 11.9.0, workspace catalogs (react
      entries stay in lockstep with the `overrides` block), TypeScript 6
      everywhere, `nodeLinker: hoisted` in `pnpm-workspace.yaml`
- [x] `@clerk/expo` pinned exactly at 3.4.6 with a version-qualified Swift 6
      patch so bumps fail loudly; `metro.config.js` reduced to the Sentry
      wrapper
- [x] Vercel build boundary in `apps/web/vercel.json`: `convex deploy` from
      the backend package, explicit web build, `VITE_CONVEX_URL` injection —
      all pnpm
- [x] Lazy-loaded markdown editor, shrinking the settings route chunk from
      493 kB to 15 kB

### Product

- [x] Full tournament settings page with pre-start edit rules
- [x] Cancel tournament and hard-delete it with all child rows (deletion is gated to test events and unpublished events with no entries; everything else is cancelled so player history survives)
- [x] Admin Overview as the organizer's live dashboard: status band (round, clock, results in, one advance action), outstanding tables, player-reported results available for organizer correction, and recent activity; the public page is a link
- [x] Markdown event details editing and public rendering
- [x] Synced round timer with organizer controls, progress chip, overtime, and
      web/public display; the native pill exists but is unmounted pending the
      custom app bar in section 8
- [x] Phase player meetings with alphabetical seating
- [x] Append-only typed tournament audit log and paginated organizer Log tab
- [x] Phase add/remove/reorder while the tournament is editable
- [x] Single-elimination playoff phases (seeding since generalized to any
      field size — section 2)
- [x] Phase cuts by rank or match points with rewind support (since
      decoupled from phase types — section 2)
- [x] Public player profiles with privacy controls, past results, and per-round history
- [x] Responsive desktop player controller
- [x] Player-facing tournament match history
- [x] Sticky admin header and sidebar
- [x] Seeded-random first-round pairings
- [x] Registered-versus-capacity counts on relevant surfaces
- [x] Public-code admin URLs
- [x] Paginated registration, pairing, and standings tables with page-size options
