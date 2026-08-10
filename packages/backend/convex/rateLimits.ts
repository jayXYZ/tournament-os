import {
  DAY,
  HOUR,
  RateLimiter,
  type RateLimitConfig,
} from "@convex-dev/rate-limiter";

import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { requireIdentity } from "./auth";

// Application-layer abuse controls for the self-serve mutation surface: every
// mutation an authenticated account can call without holding a privileged
// role, plus the membership-gated mutations that create rows or storage —
// membership is not a scarcity gate, because any account can mint its own
// organization. Buckets are keyed per identity, so one abusive account never
// starves anyone else. The numbers are sized so no human workflow — including
// a browser-E2E burst, which reuses one persistent dev-deployment user across
// runs — comes near them; they exist to stop scripted write amplification
// (audit-log growth, storage minting, registration churn, dummy-user
// seeding), not to pace legitimate play.
//
// Organizer event-day operations (pairing, timers, result entry, round
// completion, roster management) intentionally carry no limits: they run in
// bursts on event day and their blast radius is confined to the organizer's
// own events.
//
// Convex rolls back all writes — including the bucket debit — when a mutation
// throws, so these buckets meter successful calls only; hammering a mutation
// that always fails is compute abuse, which platform-level protection covers.
// Queries cannot be metered here at all (they cannot write), so the query
// surface relies on bounded reads, clamped page sizes, and viewer gating
// instead. The full policy lives in docs/rate-limiting.md.
const limits = {
  // Runs on every sign-in; each browser E2E test signs in afresh.
  upsertMe: { kind: "token bucket", rate: 120, period: HOUR, capacity: 60 },
  updateProfileSettings: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 20,
  },
  // registerSelf and cancelMyRegistration each write audit rows and flip the
  // denormalized confirmed count, so churning between them is the abuse case;
  // both draw from their own bucket at the same rate.
  registerSelf: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  cancelRegistration: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 20,
  },
  dropSelf: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  // Shared by reportMyMatchResult and confirmMatchResult: one activity, one
  // budget. A real player reports at most once a round plus corrections.
  reportResult: { kind: "token bucket", rate: 120, period: HOUR, capacity: 40 },
  // Every resubmission before lock is legitimate, but each appends an audit
  // row, so the budget bounds audit-log growth per player.
  submitDecklist: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 15,
  },
  // Organizations are the root grant for every organizer surface, so minting
  // them is the strictest limit here.
  createOrganization: { kind: "token bucket", rate: 12, period: DAY, capacity: 3 },
  // Shared by inviteMember and revokeInvitation; becomes an email budget once
  // transactional invite email lands.
  inviteMember: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  // Shared by generateProfileImageUploadUrl and updateProfileImage, so one
  // completed upload costs two tokens; the budget is really about upload URLs,
  // each of which can mint an orphaned storage blob.
  profileImageUpload: {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 10,
  },
  // Shared by createTournament, createTournamentWithPhases, and
  // createTestTournament — the test path also seeds dummy users, so it must
  // not be the cheap way around the limit.
  createTournament: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 20,
  },
  // Each call inserts up to a tournament-capacity's worth of user and
  // registration rows, so it gets its own budget on top of createTournament's.
  seedTestPlayers: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 20,
  },
} satisfies Record<string, RateLimitConfig>;

export const rateLimiter = new RateLimiter(components.rateLimiter, limits);

export type RateLimitName = keyof typeof limits;

// Debits one token from the named bucket for the calling identity, throwing
// the component's RateLimited ConvexError when the bucket is empty. Keyed by
// tokenIdentifier rather than the users row so it works before the row exists
// (upsertMe) and never needs a database read. Callers place this first in the
// handler: unauthenticated calls fail here with the same "Not authenticated"
// they would get from the handler's own auth resolution.
export async function enforceRateLimit(ctx: MutationCtx, name: RateLimitName) {
  const identity = await requireIdentity(ctx);
  await rateLimiter.limit(ctx, name, {
    key: identity.tokenIdentifier,
    throws: true,
  });
}
