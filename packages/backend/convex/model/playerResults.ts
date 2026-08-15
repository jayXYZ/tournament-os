import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { currentUserOrNull, getActiveMembership } from "./access";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { participantPublicIdentity } from "./participants";
import { MAX_MATCHES_PER_PLAYER, latestCompletedRound } from "./phases";
import { parsePublicCode } from "./publicCodes";
import { registrationForUser } from "./registrations";
import { isPairingsVisibleToPlayers, isPubliclyViewable } from "./tournaments";

// The web UI currently asks for 10 results at a time, but pagination arguments
// are public API input and cannot be trusted to preserve that bound. Keep result
// enrichment (tournament, phases, rounds, and standings reads) comfortably
// below transaction limits even when a caller requests an enormous page.
export const MAX_PROFILE_RESULTS_PAGE_SIZE = 50;

// getPublicPlayerResults tops up hidden rows server-side: it keeps walking the
// registrations index past rows the viewer can't see until the page is full.
// This caps how many raw index rows one request may examine, because every raw
// row costs a tournament read (plus membership/registration checks for
// non-public events) and a viewer-hidden stretch can be arbitrarily long.
// Hitting the cap with nothing visible returns an empty page with
// isDone: false and a cursor advanced past every examined row, so each retry
// makes budget-sized progress instead of dead-ending. Worst case per request:
// ~3 cheap reads per raw row plus full enrichment for at most
// MAX_PROFILE_RESULTS_PAGE_SIZE visible rows — comfortably inside Convex's
// 16k-document query read limit.
export const PROFILE_RESULTS_RAW_READ_BUDGET = 300;

// getPublicPlayerResults pages with an explicit index position instead of
// ctx.db's .paginate() cursor: Convex allows only one .paginate() call per
// query, so a server-side top-up loop has to seek the index itself. The
// position is the (tournamentStartDate, _creationTime) of the last raw row
// examined — _creationTime is the index's implicit final column and unique
// within a table, so the pair totally orders one user's confirmed rows.
//
// The position ships to clients ENCRYPTED. The last examined row is often one
// the viewer is not allowed to see (a private tournament, mid-scan through a
// hidden stretch), and a plaintext cursor would hand any profile viewer that
// concealed row's exact start date and creation time — metadata that can
// place the player at a specific private event. Native paginate cursors get
// the equivalent protection from the Convex backend itself (they are
// keybroker-encrypted server-side), so an explicit cursor has to supply it
// here: AES-256-GCM over the JSON payload, with a NONCE DERIVED from the
// plaintext by HMAC (SIV-style) rather than drawn from randomness, because
// Convex queries must be deterministic — the same position always produces
// the same cursor bytes, and reactive re-runs return identical results. The
// determinism trade-off is standard for SIV: equal positions yield equal
// cursors, revealing only repetition, never contents. GCM's auth tag doubles
// as the integrity check, so tampered bytes fail decryption and fall into the
// InvalidCursor handshake below.
export type ProfileResultsCursorPosition = {
  startDate: number;
  creationTime: number;
};

const PROFILE_RESULTS_CURSOR_PREFIX = "profileResults.v2.";
const PROFILE_RESULTS_CURSOR_NONCE_BYTES = 12;

// Key material comes from the deployment's Convex environment
// (`npx convex env set PROFILE_RESULTS_CURSOR_KEY <random secret>`); set it in
// production. Rotating it invalidates outstanding cursors, which clients
// recover from via the InvalidCursor reset — no worse than a session ending.
// Without the env var, keys derive from a constant baked into the deployed
// source: still opaque to app clients (they can never read deployed function
// source), but not a real secret for anyone with repo access, so it is a
// dev/test fallback only, not security for production data.
const PROFILE_RESULTS_CURSOR_DEV_FALLBACK_SECRET =
  "dev-only-fallback--set-PROFILE_RESULTS_CURSOR_KEY-in-production";

type ProfileResultsCursorKeys = {
  encryptionKey: CryptoKey;
  nonceKey: CryptoKey;
};

// CryptoKey derivation is pure (secret in, keys out), so the per-secret cache
// is just memoization; module state may or may not survive between executions
// and correctness never depends on it.
const cursorKeyCache = new Map<string, Promise<ProfileResultsCursorKeys>>();

function profileResultsCursorKeys(): Promise<ProfileResultsCursorKeys> {
  const secret =
    env.PROFILE_RESULTS_CURSOR_KEY ||
    PROFILE_RESULTS_CURSOR_DEV_FALLBACK_SECRET;
  let keys = cursorKeyCache.get(secret);
  if (keys === undefined) {
    keys = deriveProfileResultsCursorKeys(secret);
    cursorKeyCache.set(secret, keys);
  }
  return keys;
}

async function deriveProfileResultsCursorKeys(
  secret: string,
): Promise<ProfileResultsCursorKeys> {
  const encoder = new TextEncoder();
  // Domain-separated SHA-256 stretches one secret into two independent
  // 256-bit keys: one for AES-GCM, one for the HMAC that derives nonces.
  const encryptionKeyBytes = await crypto.subtle.digest(
    { name: "SHA-256" },
    encoder.encode(`${secret}|profileResultsCursor.encrypt`),
  );
  const nonceKeyBytes = await crypto.subtle.digest(
    { name: "SHA-256" },
    encoder.encode(`${secret}|profileResultsCursor.nonce`),
  );
  const [encryptionKey, nonceKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      encryptionKeyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.importKey(
      "raw",
      nonceKeyBytes,
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"],
    ),
  ]);
  return { encryptionKey, nonceKey };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Throws on non-base64url input; callers treat any throw as a bad cursor.
function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
    throw new Error("not base64url");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function encodeProfileResultsCursor(
  position: ProfileResultsCursorPosition,
): Promise<string> {
  const { encryptionKey, nonceKey } = await profileResultsCursorKeys();
  const plaintext = new TextEncoder().encode(
    JSON.stringify([position.startDate, position.creationTime]),
  );
  const nonce = new Uint8Array(
    await crypto.subtle.sign({ name: "HMAC" }, nonceKey, plaintext),
  ).subarray(0, PROFILE_RESULTS_CURSOR_NONCE_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      encryptionKey,
      plaintext,
    ),
  );
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, nonce.length);
  return PROFILE_RESULTS_CURSOR_PREFIX + toBase64Url(packed);
}

// Bad cursors — hand-edited, tampered, minted under a rotated key, or a stale
// tab holding one from before this format existed — throw the InvalidCursor
// handshake that convex/react's usePaginatedQuery recognizes (by ConvexError
// data shape and by message substring) and answers by resetting pagination
// from the first page, the same recovery a corrupt native paginate cursor
// gets. GCM authentication makes the check exhaustive: only cursors this
// deployment minted decrypt at all.
export async function decodeProfileResultsCursor(
  cursor: string,
): Promise<ProfileResultsCursorPosition> {
  if (cursor.startsWith(PROFILE_RESULTS_CURSOR_PREFIX)) {
    try {
      const packed = fromBase64Url(
        cursor.slice(PROFILE_RESULTS_CURSOR_PREFIX.length),
      );
      const nonce = packed.subarray(0, PROFILE_RESULTS_CURSOR_NONCE_BYTES);
      const ciphertext = packed.subarray(PROFILE_RESULTS_CURSOR_NONCE_BYTES);
      const { encryptionKey } = await profileResultsCursorKeys();
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        encryptionKey,
        ciphertext,
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "number" &&
        Number.isFinite(parsed[0]) &&
        typeof parsed[1] === "number" &&
        Number.isFinite(parsed[1])
      ) {
        return { startDate: parsed[0], creationTime: parsed[1] };
      }
    } catch {
      // Fall through to the InvalidCursor throw below.
    }
  }
  throw new ConvexError({
    isConvexSystemError: true,
    paginationError: "InvalidCursor",
    message: "InvalidCursor: malformed player results cursor",
  });
}

// Raw index rows strictly after `position` in profile-history order
// (tournamentStartDate desc, then _creationTime desc). A composite-key seek
// needs up to two ranges: the remainder of the cursor row's start date, then
// strictly older start dates. Returning fewer than `limit` rows means the
// index has no rows past the ones returned.
export async function takeConfirmedRegistrationsAfter(
  ctx: QueryCtx,
  participantId: Id<"participants">,
  position: ProfileResultsCursorPosition | null,
  limit: number,
) {
  if (position === null) {
    return await ctx.db
      .query("tournamentRegistrations")
      .withIndex(
        "by_participantId_and_entryStatus_and_tournamentStartDate",
        (q) =>
          q.eq("participantId", participantId).eq("entryStatus", "confirmed"),
      )
      .order("desc")
      .take(limit);
  }
  const sameStartDate = await ctx.db
    .query("tournamentRegistrations")
    .withIndex(
      "by_participantId_and_entryStatus_and_tournamentStartDate",
      (q) =>
        q
          .eq("participantId", participantId)
          .eq("entryStatus", "confirmed")
          .eq("tournamentStartDate", position.startDate)
          .lt("_creationTime", position.creationTime),
    )
    .order("desc")
    .take(limit);
  if (sameStartDate.length >= limit) {
    return sameStartDate;
  }
  const olderStartDates = await ctx.db
    .query("tournamentRegistrations")
    .withIndex(
      "by_participantId_and_entryStatus_and_tournamentStartDate",
      (q) =>
        q
          .eq("participantId", participantId)
          .eq("entryStatus", "confirmed")
          .lt("tournamentStartDate", position.startDate),
    )
    .order("desc")
    .take(limit - sameStartDate.length);
  return [...sameStartDate, ...olderStartDates];
}

// Every public profile query authorizes through this single gate so
// enforcement never depends on what the client already fetched. Returns null
// for unknown/malformed codes and for private profiles viewed by anyone but
// their owner — the two cases are deliberately indistinguishable to callers.
export async function resolvePublicPlayer(
  ctx: QueryCtx,
  rawPublicCode: string,
) {
  const publicCode = parsePublicCode(rawPublicCode);
  if (publicCode === null) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
    .unique();
  if (!user) {
    return null;
  }

  const viewer = await currentUserOrNull(ctx);
  const isOwner = viewer?._id === user._id;
  // A missing visibility (legacy/test rows) is treated as public; only an
  // explicit "private" hides the profile. Owners always resolve their own
  // profile so they can preview what they've hidden.
  if (user.profileVisibility === "private" && !isOwner) {
    return null;
  }

  return { user, viewer, isOwner };
}

export function canViewHistory({
  user,
  isOwner,
}: {
  user: Doc<"users">;
  isOwner: boolean;
}) {
  return isOwner || user.historyVisibility !== "private";
}

// Stricter than getPublicTournament: unlisted events are link-only, and a
// profile listing that named them would hand out the very link they hide
// behind — so only "public" events show unconditionally, while unlisted and
// private ones stay visible to the viewer's own registrations and org
// memberships. The membership cache spans a results loop so several such
// events from one organization cost a single membership read; it memoizes the
// in-flight promise (set synchronously, before the first await) so gates
// evaluated concurrently for one batch share that single read instead of
// racing duplicate fetches.
export async function viewerCanSeeTournament(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  viewer: Doc<"users"> | null,
  membershipCache: Map<Id<"organizations">, Promise<boolean>>,
) {
  if (tournament.visibility === "public" && isPubliclyViewable(tournament)) {
    return true;
  }
  if (!viewer) {
    return false;
  }

  let isMember = membershipCache.get(tournament.organizationId);
  if (isMember === undefined) {
    isMember = getActiveMembership(
      ctx,
      tournament.organizationId,
      viewer._id,
    ).then((membership) => membership !== null);
    membershipCache.set(tournament.organizationId, isMember);
  }
  if (await isMember) {
    return true;
  }

  const registration = await registrationForUser(
    ctx,
    tournament._id,
    viewer._id,
  );
  return registration?.entryStatus === "confirmed";
}

// A registration contributes to a profile's history only when its tournament
// finished, is a real event, the player had a confirmed entry (dropped,
// eliminated, and disqualified players are still public record), and the
// viewer could open the tournament page themselves.
export async function qualifyingCompletedTournament(
  ctx: QueryCtx,
  registration: Doc<"tournamentRegistrations">,
  viewer: Doc<"users"> | null,
  membershipCache: Map<Id<"organizations">, Promise<boolean>>,
) {
  if (registration.entryStatus !== "confirmed") {
    return null;
  }
  const tournament = await ctx.db.get(registration.tournamentId);
  if (
    !tournament ||
    tournament.lifecycle !== "completed" ||
    tournament.isTestEvent ||
    !(await viewerCanSeeTournament(ctx, tournament, viewer, membershipCache))
  ) {
    return null;
  }
  return tournament;
}

// Final placement for one player: the latest completed round's standings row.
// completeTournament requires the current round to be completed first, and
// standings rank every confirmed registration — dropped, cut, and disqualified
// players keep a row with their frozen record — so a completed tournament has
// one for every participant; a missing row is pathological
// data and renders as an unranked entry rather than dropping the tournament.
export async function finalStandingForRegistration(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  const latestCompleted = await latestCompletedRound(ctx, tournamentId);
  if (!latestCompleted) {
    return null;
  }
  const standing = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_playerId", (q) =>
      q
        .eq("tournamentRoundId", latestCompleted._id)
        .eq("playerId", registrationId),
    )
    .unique();
  if (!standing) {
    return null;
  }
  return {
    rank: standing.rank,
    matchPoints: standing.matchPoints,
    matchWins: standing.matchWins,
    matchLosses: standing.matchLosses,
    matchDraws: standing.matchDraws,
  };
}

// One player's per-round results for a tournament, restricted to rounds whose
// pairings were published. Shared by the player's own history view and the
// public profile so the two surfaces cannot drift.
export async function matchLogForRegistration(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  const playerRows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
    .take(MAX_MATCHES_PER_PLAYER);

  const historyRows = await mapAsyncInBatches(
    playerRows,
    DATABASE_IO_BATCH_SIZE,
    async (playerRow) => {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        return null;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (!round || !isPairingsVisibleToPlayers(round)) {
        return null;
      }

      // Opponent names read through the participant identity (not the
      // denormalized playerName) so an account without a name never leaks its
      // email here; a guest shows their organizer-provided display name.
      let opponentName: string | null = null;
      if (playerRow.opponentPlayerId) {
        const opponentRegistration = await ctx.db.get(
          playerRow.opponentPlayerId,
        );
        const opponentParticipant = opponentRegistration
          ? await ctx.db.get(opponentRegistration.participantId)
          : null;
        opponentName = opponentParticipant
          ? (await participantPublicIdentity(ctx, opponentParticipant)).name
          : null;
      }

      return {
        roundNumber: round.roundNumber,
        roundName: round.roundName,
        opponentName,
        isBye: playerRow.isBye,
        myGameWins: playerRow.gameWins ?? null,
        myGameLosses: playerRow.gameLosses ?? null,
        myGameDraws: playerRow.gameDraws ?? null,
        result: matchResultForRow(match, playerRow),
      };
    },
  );
  const history = historyRows.filter(
    (row): row is NonNullable<typeof row> => row !== null,
  );

  // Round numbers are global across phases, so this orders the whole
  // tournament's history.
  history.sort((left, right) => left.roundNumber - right.roundNumber);
  return history;
}

export function matchResultForRow(
  match: Doc<"tournamentMatches">,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  if (match.matchStatus !== "completed") {
    return "pending" as const;
  }
  const gameWins = playerRow.gameWins ?? 0;
  const gameLosses = playerRow.gameLosses ?? 0;
  if (playerRow.isBye || gameWins > gameLosses) {
    return "win" as const;
  }
  return gameWins < gameLosses ? ("loss" as const) : ("draw" as const);
}
