# Registrations belong to Participants; Guests auto-claim by verified email

Guest enrollment, invitations, organizer favorites, and judge conduct history
all need a competitor identity that can exist without an authenticated account
and survive individual registrations, so registrations now point at a durable
`participants` row instead of a `users` row. A Participant carries an optional
linked user (exactly one Participant per account, created lazily), and a Guest
is a Participant without one, holding an organizer-provided display name and a
normalized contact email. Test players are seeded as Guests, which replaces
the synthetic `users` rows test tournaments used to fabricate.

Claiming is automatic and happens at sign-in, mirroring how organization
invitations are accepted: every Guest whose contact email matches the
account's verified email is merged into the account holder's Participant —
registrations repointed, the Guest row deleted. We chose whole-guest merges
over partial ones: when the Guest and the claiming Participant are both
registered in the same tournament, the Guest stays unclaimed entirely, because
moving its registrations would break the one-registration-per-Participant-
per-tournament invariant, and the two entries genuinely were two entrants in
that event's record. An explicit claim UI was the alternative; automatic
merging won because the email is already verified by the identity provider and
a Guest's history appearing on first sign-in is the experience organizers
enroll guests for.

Decided 2026-08-15.

## Amendment: email enrollment, player details, and event-local names

Decided 2026-10-27, with the organizer enrollment redesign.

The organizer's direct admission is split into two explicit actions: "Enroll
player" asks only for an email; "Add guest" asks only for a name. Both admit
the player at once — a confirmed, counted entry, exempt from in-app entry
payment (`entryFeeExempt` rides on the row through Claims and organizer
reinstatements) — and neither creates a login account.

Three concerns that the first design folded together are now separate:
admission, a usable display name, and account association.

- **An email enrollment always seats a Guest**, the one already carrying the
  address or a new one, even when an account holds it. Linking the account
  at enrollment would have shown the organizer the account's name and
  avatar, making the form an account-lookup endpoint; instead every email
  enrollment starts in the same organizer-visible state, "Awaiting player
  details", and the Claim links the account the next time its holder uses
  the app. The Claim already runs on every authenticated mutation, so an
  existing account holder resolves it by opening the app — no fresh sign-in
  — which is the accepted cost of hiding account existence. The account is
  consulted only to preserve one registration per person per event: if it
  already holds a row in the event, the enrollment acts on that row
  (re-entering a cancelled one, refusing every other status) with the same
  nameless refusals the Guest's own row gets.
- **Readiness is a property of the registration, not the Participant.** An
  entry is ready when its player-safe `playerName` stamp is present. The
  Claim stamps each entry it moves from the account's name; a Guest added
  by name is ready from the start. Readiness never derives from a cached
  account or from another
  event's name for the same Guest, and play preparation — `startTournament`
  and `startPlayerMeeting` — refuses while any active entrant is unready.
  The organizer board lists them with the three resolutions: the player
  signs in with a name, the organizer names them, or the entry is removed.
- **"Continue as guest" names an entry for one event.** The name goes on
  the registration with `organizerNamed`, which the sign-in re-stamp and
  the Claim both honor, so the entry keeps its seat, history, fee treatment,
  and contact email, a later Claim does not replace the name with the
  account's profile, and no other event's entry for the person is renamed.
  Guest Participants enrolled by email therefore carry no `displayName` of
  their own.

- **An account always has a name.** `users.name` is required. The identity
  provider asks for a first and last name at sign-up, and `upsertUser` is
  the backend's own guarantee: a first sign-in without a usable name is
  refused with a user-facing error, and a later sign-in without one keeps
  the stored name rather than clearing it. So a name can never be dropped
  from under a roster or standings, the only nameless entry is one enrolled
  by email that nobody has named yet, and once play starts — which the
  gates above refuse while such an entry is in the field — every row in
  play carries a name for good. The organizer-only email fallbacks the
  in-play readers (pairings, unpaired players, standings, meeting seats, the
  audit log's match-player references) used to make for a nameless row were
  removed with it: a row's stamped name is the whole answer.

Personal invitations — an emailed invite the player accepts, or a pay-later
enrollment — are deliberately out of scope; the shareable Invite Link covers
the organizer who wants to email a player a way in.

### Review follow-ups, 2026-10-27

Three gaps the review of the enrollment redesign found, and the rules that
close them:

- **Opening the app is a sign-in.** "The Claim runs on every authenticated
  mutation" was only a promise while the web app ran the sign-in
  (`upsertMe`) on the settings page and in the organizer workspace; player
  pages only query, so an enrolled account holder opening their event page
  read as not registered, and the Register button could not recover — the
  sign-in inside `registerSelf` claimed the entry, the verb refused it as
  already registered, and the refusal rolled the Claim back. Both apps now
  run the sign-in once at the root, as soon as Convex verifies the viewer
  (`useEnsureUserRow` in `@paper-pairings/core`), and `registerSelf`
  returns a confirmed entry the Claim hands the player in that very call as
  their registration rather than refusing it.
- **The targeted Claim.** The sign-in's Claim can leave a Guest whole: a
  history too long to merge in one transaction waits for the scheduled
  walk, and a collision in another event keeps the Guest unclaimed. A
  self-registration or checkout that then ignored the Guest's entry in the
  event would seat the same person twice, and the seat it filed would be
  the collision that keeps the Guest unclaimed for good. So `registerSelf`
  and the entry checkout first take over the entry a Guest carrying the
  account's email holds in that event (`claimGuestEntryInTournament`),
  moved and stamped exactly as the Claim moves it; the walk skips rows the
  account now holds and carries on with the rest. The whole-guest rule
  stands for the automatic merge; this is the one row the player's own
  action is about.
- **An organizer's name ends with the entry.** "Continue as guest" labels a
  Guest's entry for one event, and the Claim keeps that label on the live
  entry it hands to an account. It does not outlive the entry under an
  account holder: cancelling an account holder's entry (by the player or
  the organizer) or the player's own re-entry drops `organizerNamed` and
  stamps the account's name, which the sign-in re-stamp then keeps
  current; a cancelled entry the Claim hands to an account takes the
  account's name the same way. Before this, a re-entered entry carried the
  account's name under `organizerNamed` and was frozen there for good. A
  Guest's cancelled entry keeps its name — it has no other, and an
  organizer reinstating it should not have to name it again. Organizers
  name guests, never account holders.

The stale-cache concern the review also raised — an account whose cached
email the provider has since reassigned, re-seated by an enrollment of that
email — is closed by configuration rather than code: email addresses cannot
be changed on a profile at the identity provider, so a cached email only
goes stale through an operator action (an account deleted and re-created
under the same address, a dashboard edit), and for those the sign-in's
release of stale copies and the ambiguous-holder rule in `userByEmail`
remain the guard.
