import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { presentText } from "../validators";

// The registration name-stamp module: the two denormalized name fields every
// registration row (tournament entry or convention badge) carries, the
// readiness rule built on them, and the one write that keeps a row's copies
// in step. Split out of model/registrations.ts because the participant
// module's Claim stamps the entries it moves, and the registration module
// reads participants — this module imports neither, so it sits beneath both.

// The two name fields stamped onto a registration row at write time, so list
// queries skip the user join:
//
// - playerName is the PLAYER-SAFE name: the account's name, or the name an
//   organizer typed for the entry, and nothing else. It is the copy carried
//   onward onto standings rows, match players, and meeting seats, which
//   other players read (the player standings, a seatmate's name), so the
//   stamp itself must be safe to show anyone. Only an entry enrolled by
//   email that nobody has named yet stamps nothing here: an account always
//   has a name (schema users.name).
// - organizerLabel is the ORGANIZER label: the same name, or the enrollment
//   email when there is none, so an organizer can still tell who a nameless
//   entrant is and the roster search (search_organizerLabel) can still find
//   them. It
//   lives only on the registration row, which is returned to its holder and
//   to organizers and to no one else — never copy it onto a row other
//   players read, and never return it from a player-facing query. The
//   organizer-only audit logs stamp the same label at append time
//   (model/auditLog.ts auditPlayerLabel).
//
// Both stamps are kept current: upsertUser re-stamps the account's rows when
// its name or email changes (syncRegistrationNameStamps), and the Claim
// stamps the entries it hands to an account, so an absent playerName means
// the entry has no usable name today — not a stale stamp — and the
// player-facing standings query can treat the stamp as the whole answer
// without reading through to user documents. The one exception is a row an
// organizer named for its event (organizerNamed, see the schema): its stamps
// are the event's label and both re-stamps leave them alone.
export type RegistrationNameStamp = {
  playerName: string | undefined;
  organizerLabel: string | undefined;
};

export function registrationNameStamp(identity: {
  name?: string;
  email?: string;
}): RegistrationNameStamp {
  // A blank name counts as absent (presentText), so nothing can stamp ""
  // and pass as present on a reader's fallback check.
  const playerName = presentText(identity.name);
  return {
    playerName,
    organizerLabel: playerName ?? presentText(identity.email),
  };
}

// The organizer label of a registration or badge row already in hand: no
// read. Only organizer-gated readers may show the result.
export function registrationOrganizerLabel(row: {
  playerName?: string;
  organizerLabel?: string;
}): string | undefined {
  return row.organizerLabel ?? row.playerName;
}

// Whether an entry has a name play can use (CONTEXT.md "Awaiting Player
// Details"): the player-safe stamp is present. The one predicate behind the
// start and player-meeting gates, the organizer roster's readiness marker,
// and the "Continue as guest" offer, so they can never disagree. Only an
// entry enrolled by email that nobody has named yet lacks one, until the
// player next uses the app (the Claim stamps the account's name) or an
// organizer names them.
export function registrationHasUsableName<Row extends { playerName?: string }>(
  row: Row,
): row is Row & { playerName: string } {
  return row.playerName !== undefined;
}

// The entries among `registrations` that still await a usable name.
export function unnamedRegistrations<Row extends { playerName?: string }>(
  registrations: Row[],
): Row[] {
  return registrations.filter((row) => !registrationHasUsableName(row));
}

// The refusal play preparation gives while entrants await a name — the
// start and meeting gates throw it, and the organizer board shows it as the
// reason beside its blocked action.
export function playersAwaitingDetailsReason(count: number): string {
  return `${count} ${count === 1 ? "player needs" : "players need"} a name before play can start`;
}

export function nameStampIsStale(
  row: { playerName?: string; organizerLabel?: string },
  stamp: RegistrationNameStamp,
): boolean {
  return (
    row.playerName !== stamp.playerName ||
    row.organizerLabel !== stamp.organizerLabel
  );
}

// Rewrites one tournament registration's name stamps, and the player-safe
// copy on its row in its tournament's latest completed round — the row
// getLatestStandings reads (found the way model/participation.ts
// latestStandingsRowFor finds it: the newest row by player, since rows are
// only ever created at round completion and rewinds delete the reopened
// round's). Match players and meeting seats are per-round snapshots and are
// left alone: they carry the name as it stood when the round was paired or
// the meeting seated. A row whose stamps already match is skipped.
// Shared by the sign-in re-stamp, the Claim (which stamps a claimed entry
// from the account it now belongs to), and the organizer's naming of an
// entry for its event. `fields` rides along on the registration patch for
// the one caller that sets a flag beside the stamps (organizerNamed).
export async function restampRegistrationRow(
  ctx: MutationCtx,
  registration: Doc<"tournamentRegistrations">,
  stamp: RegistrationNameStamp,
  now: number,
  fields: Partial<Pick<Doc<"tournamentRegistrations">, "organizerNamed">> = {},
): Promise<void> {
  if (nameStampIsStale(registration, stamp) || Object.keys(fields).length > 0) {
    await ctx.db.patch(registration._id, {
      ...stamp,
      ...fields,
      updatedAt: now,
    });
  }
  if (registration.entryStatus !== "confirmed") {
    return;
  }
  const [standingsRow] = await ctx.db
    .query("roundStandings")
    .withIndex("by_playerId", (q) => q.eq("playerId", registration._id))
    .order("desc")
    .take(1);
  if (standingsRow && standingsRow.playerName !== stamp.playerName) {
    await ctx.db.patch(standingsRow._id, {
      playerName: stamp.playerName,
      updatedAt: now,
    });
  }
}
