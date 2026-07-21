import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Hard ceiling on players (and therefore matches) per tournament. Bounds every
// per-tournament `.take(...)` so list and standings queries stay well under
// Convex's 4,096 index-ranges-read-per-transaction limit. Raising this requires
// re-checking that the read queries denormalize joins (see playerName fields).
export const MAX_TOURNAMENT_PLAYERS = 2048;

// Resolved display name for a user, mirroring the client's name fallback. Stored
// on registrations/standings/match players so list queries skip the user join.
export function playerDisplayName(
  user: Doc<"users"> | null | undefined,
): string | undefined {
  return user?.name ?? user?.email ?? undefined;
}

// Name for a player, preferring the denormalized copy and only reading through
// to the user document when a (legacy) registration lacks one. Used by readers
// as the fallback path so a missing denormalized name never blocks correctness.
export async function registrationDisplayName(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<string | undefined> {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    return undefined;
  }
  if (registration.playerName !== undefined) {
    return registration.playerName;
  }
  return playerDisplayName(await ctx.db.get(registration.userId));
}

export async function resolveRegistrationDisplayName(
  ctx: QueryCtx,
  playerName: string | undefined,
  registrationId: Id<"tournamentRegistrations">,
) {
  return playerName ?? (await registrationDisplayName(ctx, registrationId));
}

// Seating order for player meetings: alphabetical by display name (case-
// insensitive, locale-aware), tie-broken by registration createdAt so players
// with identical names still seat deterministically (the same tie-break
// pairing and standings use).
export function comparePlayersAlphabetically(
  a: { playerName: string | null; createdAt: number },
  b: { playerName: string | null; createdAt: number },
) {
  const byName = (a.playerName ?? "").localeCompare(
    b.playerName ?? "",
    undefined,
    {
      sensitivity: "base",
    },
  );
  return byName !== 0 ? byName : a.createdAt - b.createdAt;
}

export async function requireRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }
  return registration;
}

export async function registrationForUser(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_userId", (q) =>
      q.eq("tournamentId", tournamentId).eq("userId", userId),
    )
    .unique();
}

// Includes dropped/eliminated/disqualified players: their match history must
// still feed opponents' tiebreakers even though they are no longer ranked.
// Collects every row rather than capping at MAX_TOURNAMENT_PLAYERS: capacity
// only bounds *active* registrations, but dropped rows persist (one row per
// user, reused on re-register), so churn can push the total past capacity. A
// cap here would silently drop the newest rows — potentially active entrants —
// from standings. The query is scoped to a single tournament via an equality
// index, and Convex's read limit is the backstop against pathological churn.
export async function allRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .collect();
}

export async function activeRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId).eq("status", "active"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

export function requireCapacityAvailable(tournament: Doc<"tournaments">) {
  if (tournament.activeRegistrationCount >= tournament.playerCapacity) {
    throw new Error("Tournament is at capacity");
  }
}

// Maintains the denormalized active-registration count on the tournament so
// list queries never fan out into per-tournament registration scans. Callers
// pass the signed delta for the status transition they just applied.
export async function adjustActiveRegistrationCount(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(tournament._id, {
    activeRegistrationCount: Math.max(
      0,
      tournament.activeRegistrationCount + delta,
    ),
    updatedAt: now,
  });
}

type RegistrationStatusUpdate =
  | {
      status: "eliminated";
      eliminatedByRoundId: Id<"tournamentRounds">;
    }
  | {
      status: "active" | "dropped";
      eliminatedByRoundId?: never;
    };

export async function setRegistrationStatus(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  update: RegistrationStatusUpdate & {
    playerName?: string;
    updatedAt?: number;
  },
) {
  const { updatedAt = Date.now(), ...fields } = update;
  await ctx.db.patch(registrationId, {
    ...fields,
    eliminatedByRoundId:
      update.status === "eliminated" ? update.eliminatedByRoundId : undefined,
    updatedAt,
  });
}
