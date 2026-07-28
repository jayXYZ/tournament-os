// Label for a registration row that exists but is malformed: entryStatus is
// "confirmed" with no participationStatus recorded. Every write path pairs
// the two — setRegistrationState's RegistrationStateUpdate union requires a
// participationStatus whenever entryStatus is "confirmed", and both direct
// inserts of a confirmed row set one too — so this should not occur in
// practice. It exists only because participationStatus is optional at the
// schema level; callers still need a defined, single label for it.
export const MALFORMED_REGISTRATION_STATUS = "unknown" as const;

// Label for a seat (or other join) whose registration no longer exists at
// all, e.g. it was deleted. This is a different situation from a malformed
// row above — the row is gone, not corrupt — and callers must not conflate
// the two under one fallback.
export const DELETED_REGISTRATION_STATUS = "removed" as const;

// The status a registration is effectively in: entry workflow states
// (pending, waitlisted, cancelled, rejected) pass through untouched, while a
// confirmed entry collapses to its participation status (falling back to
// MALFORMED_REGISTRATION_STATUS for the normally-impossible case above).
// Single source of the collapse rule for the organizer roster and the
// player-meeting seat join; callers that live-join against a registration
// that may no longer exist supply DELETED_REGISTRATION_STATUS themselves for
// that case rather than re-deriving a label for it.
export function effectiveRegistrationStatus<
  Registration extends {
    entryStatus: string;
    participationStatus?: string | null;
  },
>(
  registration: Registration,
):
  | Registration["entryStatus"]
  | NonNullable<Registration["participationStatus"]>
  | typeof MALFORMED_REGISTRATION_STATUS {
  return registration.entryStatus === "confirmed"
    ? (registration.participationStatus ?? MALFORMED_REGISTRATION_STATUS)
    : registration.entryStatus;
}
