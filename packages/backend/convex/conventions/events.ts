import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import {
  attachTournamentToConvention,
  canViewConvention,
  detachTournamentFromConvention,
  requireConvention,
  requireConventionOrganizerAccess,
} from "../model/conventions";
import {
  createTournament as createTournamentModel,
  isPubliclyViewable,
  requireTournament,
} from "../model/tournaments";
import { enforceRateLimit } from "../rateLimits";
import { tournamentCreationArgs } from "../validators";

// The parent-child surface: which tournaments a convention holds, and the
// attach/detach/create verbs that change it. The rules live in
// model/conventions.ts; a tournament belongs to zero or one convention and
// conventions never nest (schema.ts).

// The organizer's child-event list: attached tournaments in schedule order,
// paginated — a convention can hold more events than any fixed cap.
export const listChildEvents = query({
  args: {
    conventionId: v.id("conventions"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    const result = await ctx.db
      .query("tournaments")
      .withIndex("by_conventionId_and_startDate", (q) =>
        q.eq("conventionId", args.conventionId),
      )
      .order("asc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((tournament) => ({
        ...tournament,
        registeredCount: tournament.confirmedRegistrationCount,
      })),
    };
  },
});

// The public convention page's child-event list: attached tournaments the
// viewer could open themselves, paginated like the organizer list. Direct
// tournament URLs and standalone discovery stay untouched — this is one
// more way in, not the only one. Follows the convention page's own access
// rule (canViewConvention), so the organizing team and badge holders keep
// their child-event list on a private convention. Non-public children are
// filtered from each page after the read, so a page may come back short;
// the cursor still advances.
export const listPublicChildEvents = query({
  args: {
    conventionId: v.id("conventions"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const convention = await requireConvention(ctx, args.conventionId);
    if (!(await canViewConvention(ctx, convention))) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("tournaments")
      .withIndex("by_conventionId_and_startDate", (q) =>
        q.eq("conventionId", args.conventionId),
      )
      .order("asc")
      .paginate(args.paginationOpts);
    const organization = await ctx.db.get(convention.organizationId);
    return {
      ...result,
      page: result.page
        .filter((tournament) => isPubliclyViewable(tournament))
        .map((tournament) => ({
          ...tournament,
          organizationName: organization?.name ?? null,
          registeredCount: tournament.confirmedRegistrationCount,
        })),
    };
  },
});

// The overview page's stat: how many events the convention holds, capped
// honestly ("200+") — one integer over the wire instead of a 200-row live
// page subscribed just to be counted.
export const countChildEvents = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    const rows = await ctx.db
      .query("tournaments")
      .withIndex("by_conventionId_and_startDate", (q) =>
        q.eq("conventionId", args.conventionId),
      )
      .take(201);
    return { count: Math.min(rows.length, 200), hasMore: rows.length > 200 };
  },
});

// The organization's tournaments an attach dialog can offer: unattached,
// not started, newest start first. The conventionId filter is in memory
// over a bounded read — no index can express "field absent".
export const listAttachableTournaments = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const rows = (
      await Promise.all(
        (["setup", "registration"] as const).map((lifecycle) =>
          ctx.db
            .query("tournaments")
            .withIndex("by_organizationId_and_lifecycle_and_startDate", (q) =>
              q
                .eq("organizationId", convention.organizationId)
                .eq("lifecycle", lifecycle),
            )
            .order("desc")
            .take(100),
        ),
      )
    ).flat();
    rows.sort((left, right) => right.startDate - left.startDate);
    return rows
      .filter((tournament) => tournament.conventionId === undefined)
      .map((tournament) => ({
        ...tournament,
        registeredCount: tournament.confirmedRegistrationCount,
      }));
  },
});

export const attachTournament = mutation({
  args: {
    conventionId: v.id("conventions"),
    tournamentId: v.id("tournaments"),
  },
  handler: async (ctx, args) => {
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const tournament = await requireTournament(ctx, args.tournamentId);
    await attachTournamentToConvention(ctx, {
      convention,
      tournament,
      actor: user,
    });
    return args.tournamentId;
  },
});

export const detachTournament = mutation({
  args: {
    conventionId: v.id("conventions"),
    tournamentId: v.id("tournaments"),
  },
  handler: async (ctx, args) => {
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const tournament = await requireTournament(ctx, args.tournamentId);
    await detachTournamentFromConvention(ctx, {
      convention,
      tournament,
      actor: user,
    });
    return args.tournamentId;
  },
});

// Creates a child tournament directly under the convention: the same create
// path as createTournamentWithPhases, then the attach verb (with its audit
// line) links it. Test children follow the convention's own flag so a test
// convention never mints real events.
export const createTournamentForConvention = mutation({
  args: {
    conventionId: v.id("conventions"),
    ...tournamentCreationArgs,
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    await enforceRateLimit(ctx, "createTournament");
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const { tournamentId } = await createTournamentModel(ctx, {
      organizationId: convention.organizationId,
      name: args.name,
      startDate: args.startDate,
      playerCapacity: args.playerCapacity,
      format: args.format,
      isTestEvent: convention.isTestEvent,
      decklistRequired: args.decklistRequired ?? false,
      phases: args.phases,
    });
    const tournament = await requireTournament(ctx, tournamentId);
    await attachTournamentToConvention(ctx, {
      convention,
      tournament,
      actor: user,
    });
    return tournamentId;
  },
});
