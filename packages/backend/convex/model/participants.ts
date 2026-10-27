import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "../validators";
import {
  type RegistrationNameStamp,
  registrationNameStamp,
  restampRegistrationRow,
} from "./nameStamps";

// The durable competitor identity module (CONTEXT.md "Participant", ADR
// 0002): registrations belong to participants, a participant links to at most
// one user account, and a Guest is a participant without one. Its interface
// is the user↔participant resolution both read and write paths go through,
// guest creation, and the sign-in Claim that merges matching guests into an
// account holder's participant.

// How many guests one sign-in will examine for claiming; matches the
// pending-invitation bound in model/users.ts.
const CLAIMABLE_GUESTS_BOUND = 64;
// The largest guest history the sign-in merges in its own transaction, and
// the page size of the scheduled walk that merges a larger one. A regular
// enrolled week after week by the same email accumulates one history, so a
// guest past the bound is ordinary, not anomalous: it is claimed by the
// walk (startGuestClaimWalk), never skipped.
const CLAIM_REGISTRATION_BATCH = 64;
// How long a started walk holds off another for the same guest. Each step
// refreshes the stamp, so this only lapses on a walk that stopped — a
// collision refusal, or a step that failed — and the next sign-in after it
// tries again.
const CLAIM_WALK_RETRY_MS = 60 * 60 * 1000;

export async function requireParticipant(
  ctx: QueryCtx,
  participantId: Id<"participants">,
) {
  const participant = await ctx.db.get(participantId);
  if (!participant) {
    throw new Error("Participant not found");
  }
  return participant;
}

// The account holder's participant, or null when nothing has needed it yet.
// Query paths treat null as "no registrations exist": every registration
// points at a participant, so a user without one cannot hold any.
export async function participantForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"participants"> | null> {
  return await ctx.db
    .query("participants")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

// Get-or-create the account holder's participant: exactly one per user,
// created the first time a write path needs it.
export async function ensureParticipantForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"participants">> {
  const existing = await participantForUser(ctx, userId);
  if (existing) {
    return existing;
  }
  const participantId = await ctx.db.insert("participants", {
    userId,
    updatedAt: Date.now(),
  });
  return await requireParticipant(ctx, participantId);
}

// A Guest: no linked user. A guest added by name carries that display name;
// a guest enrolled by email carries only the contact email (the claim key —
// normalized so sign-in matching is exact), and the names organizers later
// give it live on its registrations, one per event (schema
// tournamentRegistrations.organizerNamed).
export async function createGuestParticipant(
  ctx: MutationCtx,
  args: { displayName?: string; contactEmail?: string },
): Promise<Id<"participants">> {
  return await ctx.db.insert("participants", {
    displayName: args.displayName,
    contactEmail:
      args.contactEmail === undefined
        ? undefined
        : normalizeEmail(args.contactEmail),
    updatedAt: Date.now(),
  });
}

// Whether a participant is a Guest — no linked account. The payment paths
// ask this before minting an order: a guest has no account to pay from
// (createEntryOrder refuses one outright), so the organizer verbs seat a
// guest on a paid event directly instead of requesting a payment nobody
// could make.
export async function isGuestParticipant(
  ctx: QueryCtx,
  participantId: Id<"participants">,
): Promise<boolean> {
  const participant = await ctx.db.get(participantId);
  return participant === null || participant.userId === undefined;
}

// How many guests an email lookup examines when an enrollment reuses one.
// Guests are deduplicated by this very lookup, so the match is normally a
// single row; the bound only guards against hand-seeded duplicates.
const GUESTS_PER_EMAIL_BOUND = 8;

// The Guest already carrying a contact email, for an organizer enrollment
// to reuse (model/roster.ts enrollPlayer): a regular enrolled across several
// events stays one Participant with one history and one Claim. The guest is
// returned untouched: the name each organizer typed belongs to that
// organizer's registration (its playerName stamp), and the guest's own
// displayName is shared by every event it plays in, so letting a later
// enrollment rewrite it would rename the player in other organizers'
// events. Null when no Guest holds the email; a user-linked participant
// never matches, because it carries no contactEmail (the account's email is
// on the user).
export async function guestParticipantForEmail(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<"participants"> | null> {
  const matches = await ctx.db
    .query("participants")
    .withIndex("by_contactEmail", (q) =>
      q.eq("contactEmail", normalizeEmail(email)),
    )
    .take(GUESTS_PER_EMAIL_BOUND);
  return matches.find((match) => match.userId === undefined) ?? null;
}

// The name and avatar a participant shows other players and the public.
// User-linked participants read through to the account (name only — never
// the email, which player-facing surfaces must not leak); guests show the
// display name they were added with (set only for a guest added by name)
// and have no avatar. Registration-level surfaces should prefer
// publicIdentityForRegistration, which honors the event's own name for the
// entry.
export async function participantPublicIdentity(
  ctx: QueryCtx,
  participant: Doc<"participants">,
): Promise<{ name: string | null; avatarUrl: string | null }> {
  if (participant.userId === undefined) {
    return { name: participant.displayName ?? null, avatarUrl: null };
  }
  const user = await ctx.db.get(participant.userId);
  return { name: user?.name ?? null, avatarUrl: user?.avatarUrl ?? null };
}

// A registration's public identity, resolved for the surfaces that show an
// opponent to other players (the Player View's match card, the profile match
// log). An entry an organizer named for this event (organizerNamed) shows
// that name and no avatar, whoever holds it: the name is the event's label
// for the entrant, and a linked account's profile is not disclosed in its
// place just because the Claim found one. Any other guest entry shows its
// own registration's name — never another event's name for the same guest,
// and never an email (the playerName stamp is player-safe by construction)
// — so an entry still awaiting player details shows nothing. An account's
// entry reads through to the account (its name and avatar), never the
// denormalized stamp. Null fields when the registration or participant is
// gone.
export async function publicIdentityForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<{ name: string | null; avatarUrl: string | null }> {
  const registration = await ctx.db.get(registrationId);
  const participant = registration
    ? await ctx.db.get(registration.participantId)
    : null;
  if (!registration || !participant) {
    return { name: null, avatarUrl: null };
  }
  if (registration.organizerNamed || participant.userId === undefined) {
    return { name: registration.playerName ?? null, avatarUrl: null };
  }
  return await participantPublicIdentity(ctx, participant);
}

// The sign-in Claim (CONTEXT.md "Claim", ADR 0002): merge every guest whose
// contact email matches the account's verified email into the account
// holder's participant — repoint the guest's registrations, delete the guest.
// All-or-nothing per guest: when the guest and the claiming participant both
// hold a registration in the same tournament, the guest stays unclaimed, so
// the one-registration-per-participant-per-tournament invariant survives and
// no event record is rewritten. Runs on every authenticated sign-in and
// mutation (like invitation acceptance), so a guest enrolled after the
// account existed is claimed the next time its holder uses the app — no
// fresh sign-in needed. A guest whose history is too long to merge here is
// handed to a scheduled walk with the same all-or-nothing rule
// (startGuestClaimWalk). Each moved entry is stamped from the account
// (claimedRegistrationStamp), which is how an entry enrolled by email gains
// its name: the player authenticated after the enrollment with a usable
// name, and the entry stops awaiting player details. Returns the entries it
// moved here and now (the walk's are not included), for the one caller that
// must tell a seat this Claim just handed the player from one they already
// held (model/roster.ts registerEntry).
export async function claimGuestParticipants(
  ctx: MutationCtx,
  args: { userId: Id<"users">; email?: string; now: number },
): Promise<Id<"tournamentRegistrations">[]> {
  if (!args.email) {
    return [];
  }
  const email = normalizeEmail(args.email);
  const guests = await guestsForEmail(ctx, email);
  if (guests.length === 0) {
    return [];
  }

  const claimer = await ensureParticipantForUser(ctx, args.userId);
  const stamp = await claimedRegistrationStamp(ctx, claimer);
  const claimed: Id<"tournamentRegistrations">[] = [];
  for (const guest of guests) {
    const guestRegistrations = await guestRegistrationsQuery(
      ctx,
      guest._id,
    ).take(CLAIM_REGISTRATION_BATCH);
    if (guestRegistrations.length === CLAIM_REGISTRATION_BATCH) {
      await startGuestClaimWalk(ctx, { guest, claimer, now: args.now });
      continue;
    }
    if (await anyRegistrationCollides(ctx, guestRegistrations, claimer._id)) {
      continue;
    }
    for (const registration of guestRegistrations) {
      await moveRegistrationToClaimer(ctx, {
        registration,
        claimer,
        stamp,
        now: args.now,
      });
      claimed.push(registration._id);
    }
    await ctx.db.delete(guest._id);
  }
  return claimed;
}

// Whether any Guest carries a contact email: the Claim's own lookup
// (guestsForEmail), reduced to the yes/no the apps' sign-in subscribes to
// (users.ts hasUnclaimedGuest) so a Guest appearing under the viewer's
// email while the app is open is claimed as it lands.
export async function anyGuestForEmail(
  ctx: QueryCtx,
  email: string,
): Promise<boolean> {
  return (await guestsForEmail(ctx, normalizeEmail(email))).length > 0;
}

// Every Guest carrying a contact email — the rows the Claim examines, one
// bounded index read.
async function guestsForEmail(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<"participants">[]> {
  const matches = await ctx.db
    .query("participants")
    .withIndex("by_contactEmail", (q) => q.eq("contactEmail", email))
    .take(CLAIMABLE_GUESTS_BOUND);
  return matches.filter((match) => match.userId === undefined);
}

// The Claim's targeted form, for the account holder's own entry into one
// event (model/roster.ts registerEntry, payments/checkout.ts
// beginEntryCheckout): the entry a Guest carrying the account's email holds
// in that tournament is handed to the account before the account files one
// of its own. The sign-in Claim can leave such an entry with the guest — a
// history too long to merge inline is walked afterwards (startGuestClaimWalk),
// and a guest colliding with the account in another event stays unclaimed —
// and a self-registration that overlooked it would seat the same person
// twice in one event, then be the very collision the walk refuses. So the
// entry the player already has in the event is theirs: moved and stamped
// exactly as the Claim moves it (moveRegistrationToClaimer), the guest
// deleted once nothing else points at it, and the walk — which skips rows
// the account now holds — carries on with the rest. Null when no guest holds
// a row in the tournament. The account must hold no row there, which the
// callers establish first.
export async function claimGuestEntryInTournament(
  ctx: MutationCtx,
  args: { user: Doc<"users">; tournamentId: Id<"tournaments">; now: number },
): Promise<Doc<"tournamentRegistrations"> | null> {
  if (args.user.email === undefined) {
    return null;
  }
  for (const guest of await guestsForEmail(ctx, args.user.email)) {
    const registration = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_participantId", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("participantId", guest._id),
      )
      .unique();
    if (!registration) {
      continue;
    }
    const claimer = await ensureParticipantForUser(ctx, args.user._id);
    await moveRegistrationToClaimer(ctx, {
      registration,
      claimer,
      stamp: registrationNameStamp(args.user),
      now: args.now,
    });
    if ((await guestRegistrationsQuery(ctx, guest._id).first()) === null) {
      await ctx.db.delete(guest._id);
    }
    return await requireRegistrationRow(ctx, registration._id);
  }
  return null;
}

async function requireRegistrationRow(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<Doc<"tournamentRegistrations">> {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }
  return registration;
}

// The name stamp a claimed entry takes from the account that now holds it:
// the same stamp registerSelf would write for the account (its name), so a
// claimed entry and a self-registered one read alike everywhere.
async function claimedRegistrationStamp(
  ctx: QueryCtx,
  claimer: Doc<"participants">,
): Promise<RegistrationNameStamp> {
  const user =
    claimer.userId === undefined ? null : await ctx.db.get(claimer.userId);
  return registrationNameStamp(user ?? {});
}

// Hands one registration to the claiming participant and stamps it from the
// account — unless an organizer named the entry for its event
// (organizerNamed) and the entry is still live: that name is the event's
// label for the entrant and stays, whoever holds the entry now. A cancelled
// entry's organizer name does not survive the hand-over: organizers name
// guests, not account holders (CONTEXT.md "Claim"), so an account's
// cancelled entry carries the account's own name, as it would had the
// account held it when it was cancelled (model/roster.ts cancelEntry), and
// re-admitting it never revives the label. Entry status, seat, history, and
// the fee exemption (entryFeeExempt) ride along untouched.
async function moveRegistrationToClaimer(
  ctx: MutationCtx,
  args: {
    registration: Doc<"tournamentRegistrations">;
    claimer: Doc<"participants">;
    stamp: RegistrationNameStamp;
    now: number;
  },
): Promise<void> {
  const { registration, claimer, stamp, now } = args;
  await ctx.db.patch(registration._id, {
    participantId: claimer._id,
    updatedAt: now,
  });
  if (!registration.organizerNamed) {
    await restampRegistrationRow(ctx, registration, stamp, now);
  } else if (registration.entryStatus === "cancelled") {
    await restampRegistrationRow(ctx, registration, stamp, now, {
      organizerNamed: undefined,
    });
  }
}

// Every registration a participant holds, whatever its status — the claim
// needs cancelled and rejected rows too, since a merged identity keeps its
// whole history (prefix query on the participant index).
function guestRegistrationsQuery(
  ctx: QueryCtx,
  participantId: Id<"participants">,
) {
  return ctx.db
    .query("tournamentRegistrations")
    .withIndex(
      "by_participantId_and_entryStatus_and_tournamentStartDate",
      (q) => q.eq("participantId", participantId),
    );
}

// Whether the claiming participant already holds a registration in the same
// tournament as one of these — the collision that keeps a guest unclaimed.
async function anyRegistrationCollides(
  ctx: QueryCtx,
  registrations: Doc<"tournamentRegistrations">[],
  claimerId: Id<"participants">,
): Promise<boolean> {
  for (const registration of registrations) {
    if (await claimerHoldsTournament(ctx, claimerId, registration)) {
      return true;
    }
  }
  return false;
}

async function claimerHoldsTournament(
  ctx: QueryCtx,
  claimerId: Id<"participants">,
  registration: Doc<"tournamentRegistrations">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_participantId", (q) =>
      q
        .eq("tournamentId", registration.tournamentId)
        .eq("participantId", claimerId),
    )
    .unique();
  return existing !== null;
}

export type GuestClaimWalkStep = {
  guestId: Id<"participants">;
  claimerId: Id<"participants">;
  // "check" pages through the whole history for a collision before anything
  // moves; "move" then repoints it page by page.
  phase: "check" | "move";
  cursor: string | null;
};

// Hands a guest too large for the sign-in transaction to the scheduled
// claim walk (continueGuestClaimWalk), unless a walk for it started within
// CLAIM_WALK_RETRY_MS — every authenticated mutation runs the sign-in claim,
// and one walk at a time is enough.
async function startGuestClaimWalk(
  ctx: MutationCtx,
  args: {
    guest: Doc<"participants">;
    claimer: Doc<"participants">;
    now: number;
  },
): Promise<void> {
  const { guest, claimer, now } = args;
  if (
    guest.claimWalkAt !== undefined &&
    now - guest.claimWalkAt < CLAIM_WALK_RETRY_MS
  ) {
    return;
  }
  await scheduleGuestClaimWalkStep(
    ctx,
    {
      guestId: guest._id,
      claimerId: claimer._id,
      phase: "check",
      cursor: null,
    },
    now,
  );
}

async function scheduleGuestClaimWalkStep(
  ctx: MutationCtx,
  step: GuestClaimWalkStep,
  now: number,
): Promise<void> {
  await ctx.db.patch(step.guestId, { claimWalkAt: now });
  await ctx.scheduler.runAfter(0, internal.users.continueGuestClaimWalk, step);
}

// One page of the scheduled Claim of a large guest. The check phase reads
// the whole history for a collision first, so the merge stays all-or-nothing
// as at sign-in: a collision ends the walk with nothing moved, and the
// guest stays unclaimed. The move phase then repoints page by page and
// deletes the guest once nothing points at it. A collision can still appear
// between the phases — the account holder registering themself into an
// event the guest is entered in — and that row alone stays with the guest:
// moving it would break one-registration-per-participant-per-tournament.
// Rows enrolled onto the guest mid-walk likewise keep it alive, and the
// next sign-in claims them. The walk stops quietly when either side is
// gone or the guest has become an account's participant.
export async function continueGuestClaimWalk(
  ctx: MutationCtx,
  step: GuestClaimWalkStep,
): Promise<void> {
  const guest = await ctx.db.get(step.guestId);
  const claimer = await ctx.db.get(step.claimerId);
  if (
    !guest ||
    guest.userId !== undefined ||
    !claimer ||
    claimer.userId === undefined
  ) {
    return;
  }
  const now = Date.now();
  const page = await guestRegistrationsQuery(ctx, guest._id).paginate({
    numItems: CLAIM_REGISTRATION_BATCH,
    cursor: step.cursor,
  });

  if (step.phase === "check") {
    if (await anyRegistrationCollides(ctx, page.page, claimer._id)) {
      return;
    }
    await scheduleGuestClaimWalkStep(
      ctx,
      page.isDone
        ? { ...step, phase: "move", cursor: null }
        : { ...step, cursor: page.continueCursor },
      now,
    );
    return;
  }

  const stamp = await claimedRegistrationStamp(ctx, claimer);
  for (const registration of page.page) {
    if (await claimerHoldsTournament(ctx, claimer._id, registration)) {
      continue;
    }
    await moveRegistrationToClaimer(ctx, { registration, claimer, stamp, now });
  }
  if (!page.isDone) {
    await scheduleGuestClaimWalkStep(
      ctx,
      { ...step, cursor: page.continueCursor },
      now,
    );
    return;
  }
  const remaining = await guestRegistrationsQuery(ctx, guest._id).first();
  if (remaining === null) {
    await ctx.db.delete(guest._id);
  } else {
    // Done walking: the next sign-in may take up what is left at once.
    await ctx.db.patch(guest._id, { claimWalkAt: undefined, updatedAt: now });
  }
}
