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
  Claim stamps each entry it moves from the account's name; a nameless
  account's entry stays unready; a Guest added by name is ready from the
  start. Readiness never derives from a cached account or from another
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

Personal invitations — an emailed invite the player accepts, or a pay-later
enrollment — are deliberately out of scope; the shareable Invite Link covers
the organizer who wants to email a player a way in.
