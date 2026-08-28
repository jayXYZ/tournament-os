import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "../validators";

// The durable competitor identity module (CONTEXT.md "Participant", ADR
// 0002): registrations belong to participants, a participant links to at most
// one user account, and a Guest is a participant without one. Its interface
// is the user↔participant resolution both read and write paths go through,
// guest creation, and the sign-in Claim that merges matching guests into an
// account holder's participant.

// How many guests one sign-in will examine for claiming; matches the
// pending-invitation bound in model/users.ts.
const CLAIMABLE_GUESTS_BOUND = 64;
// Bound on a claimed guest's registrations. Guests are enrolled by
// organizers one event at a time, so their histories are short; a guest at
// the bound is skipped rather than merged partially.
const CLAIM_REGISTRATION_BATCH = 64;

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

// A Guest: organizer-provided display name, optional contact email (the
// claim key — normalized so sign-in matching is exact). No linked user.
export async function createGuestParticipant(
  ctx: MutationCtx,
  args: { displayName: string; contactEmail?: string },
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

// The name and avatar a participant shows other players and the public.
// User-linked participants read through to the account (name only — never
// the email, which player-facing surfaces must not leak); guests show the
// organizer-provided display name and have no avatar.
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

// A registration's public identity, resolved through its participant. The
// shared read for surfaces that show an opponent to other players (the Player
// View's match card, the profile match log): always through the participant
// identity, never the denormalized playerName, so an account without a name
// can never leak its email. Null fields when the registration or participant
// is gone.
export async function publicIdentityForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<{ name: string | null; avatarUrl: string | null }> {
  const registration = await ctx.db.get(registrationId);
  const participant = registration
    ? await ctx.db.get(registration.participantId)
    : null;
  return participant
    ? await participantPublicIdentity(ctx, participant)
    : { name: null, avatarUrl: null };
}

// The sign-in Claim (CONTEXT.md "Claim", ADR 0002): merge every guest whose
// contact email matches the account's verified email into the account
// holder's participant — repoint the guest's registrations, delete the guest.
// All-or-nothing per guest: when the guest and the claiming participant both
// hold a registration in the same tournament, the guest stays unclaimed, so
// the one-registration-per-participant-per-tournament invariant survives and
// no event record is rewritten. Runs on every sign-in (like invitation
// acceptance) so a guest enrolled after the account existed is still claimed.
export async function claimGuestParticipants(
  ctx: MutationCtx,
  args: { userId: Id<"users">; email?: string; now: number },
): Promise<void> {
  if (!args.email) {
    return;
  }
  const email = normalizeEmail(args.email);
  const matches = await ctx.db
    .query("participants")
    .withIndex("by_contactEmail", (q) => q.eq("contactEmail", email))
    .take(CLAIMABLE_GUESTS_BOUND);
  const guests = matches.filter((match) => match.userId === undefined);
  if (guests.length === 0) {
    return;
  }

  const claimer = await ensureParticipantForUser(ctx, args.userId);
  for (const guest of guests) {
    const guestRegistrations = await allRegistrationsForParticipant(
      ctx,
      guest._id,
    );
    if (guestRegistrations === "overflow") {
      continue;
    }
    let collides = false;
    for (const registration of guestRegistrations) {
      const existing = await ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_participantId", (q) =>
          q
            .eq("tournamentId", registration.tournamentId)
            .eq("participantId", claimer._id),
        )
        .unique();
      if (existing) {
        collides = true;
        break;
      }
    }
    if (collides) {
      continue;
    }
    for (const registration of guestRegistrations) {
      await ctx.db.patch(registration._id, {
        participantId: claimer._id,
        updatedAt: args.now,
      });
    }
    await ctx.db.delete(guest._id);
  }
}

// Every registration a participant holds, whatever its status — the claim
// walk needs cancelled and rejected rows too, since a merged identity keeps
// its whole history (prefix query on the participant index). Guest histories
// are short; a full page means this guest is unexpectedly large, and the
// caller skips it rather than merge partially.
async function allRegistrationsForParticipant(
  ctx: QueryCtx,
  participantId: Id<"participants">,
): Promise<Doc<"tournamentRegistrations">[] | "overflow"> {
  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex(
      "by_participantId_and_entryStatus_and_tournamentStartDate",
      (q) => q.eq("participantId", participantId),
    )
    .take(CLAIM_REGISTRATION_BATCH);
  return registrations.length === CLAIM_REGISTRATION_BATCH
    ? "overflow"
    : registrations;
}
