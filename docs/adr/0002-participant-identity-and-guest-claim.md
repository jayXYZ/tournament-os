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
