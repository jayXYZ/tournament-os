import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { droppedRegistrations, MAX_TOURNAMENT_PLAYERS } from "./registrations";

export type TournamentPhaseCutoff = NonNullable<
  Doc<"tournamentPhases">["phaseCutoff"]
>;

// ---------------------------------------------------------------------------
// The cut / entry-field model
// ---------------------------------------------------------------------------
// A cut turns one phase's final standings into the next phase's entry field.
// What defines that field depends on how far the next phase's player meeting
// has got, so cutoffPartitionForNextPhase routes to one of three partitions
// (that function's comment documents the routing). All three answer the same
// two questions — who enters, and who must be recorded as out — and all three
// keep one invariant, which is what makes reinstating safe:
//
//   STAMPING INVARIANT. Every confirmed participant who neither qualifies nor
//   holds a place in the entering field ends up carrying eliminatedByRoundId:
//   the active ones because eliminateNonQualifiers stamps everyone outside
//   `qualifiers`, the withdrawn ones because they come back in
//   `droppedNonQualifiers`. reinstateRegistration reads that stamp, so no
//   reinstate can grow the field past the cut it was drawn to.
//
// The invariant is what the older "the two sets are exact complements" wording
// was reaching for, but complements they are not: exactly one kind of player is
// deliberately in neither the qualifying nor the stamped set — a withdrawn
// player who holds a place they cannot play. Nothing is backfilled into that
// place, and with no stamp a reinstate returns them to play; the partition
// names them in `heldPlaces` so a caller staring at a short field can say who
// to reinstate. Which withdrawals hold a place is the one rule the three
// partitions differ on:
//
//   * no meeting snapshot  none of them. The field freezes at pairing time, so
//                          a withdrawal always frees its place and the next
//                          player below moves up.
//   * live meeting         every seated player. The seats ARE the frozen
//                          field, and a seat is an earned entry.
//   * superseded snapshot  seated players who still clear the re-drawn
//                          boundary. The seats outlived the standings they
//                          were drawn from, so a seat alone no longer proves
//                          the player belongs in the field; a seated player
//                          the correction pushed below the boundary is cut and
//                          stamped, exactly like an active seat holder in the
//                          same position. Slot-holding cannot express the
//                          protection under a points bar anyway — there are no
//                          slots there, only the bar — so the stamp is the
//                          only rule available that works for both cutoff
//                          kinds.
// ---------------------------------------------------------------------------

// Both sides of a cut, drawn from one boundary computation so they can never
// disagree: the qualifiers who enter the next phase, and the players who had
// already withdrawn when the cut ran and hold no place in the entering field.
// The latter keep an elimination record (preserveDroppedEliminations), so
// reinstating them restores "eliminated" instead of reviving them past a cut
// they missed. See the stamping invariant above for how the two sets, plus
// eliminateNonQualifiers, cover every confirmed participant.
//
// `heldPlaces` names the third kind of player the stamping invariant describes:
// withdrawn players who still hold a place in the entering field. They enter
// nothing and are stamped with nothing — reinstating one returns them to play,
// filling the place they held. Each held place shrinks `qualifiers` below the
// cut size without freeing a seat, so this is the set a caller reaches for when
// the qualifiers alone are too few to pair: reinstating a held-place player is
// the one move that grows the field, and completing the tournament is the only
// alternative. Always empty when no meeting granted entries (the standard cut
// frees every withdrawn place instead).
export type CutoffPartition = {
  qualifiers: Doc<"tournamentRegistrations">[];
  droppedNonQualifiers: Doc<"tournamentRegistrations">[];
  heldPlaces: Doc<"tournamentRegistrations">[];
};

// The boundary walk shared by every cut that reads standings. Walks the
// phase-final standings in rank order handing out the cutoff's places: a top-X
// cut has X of them, a points bar has one for every record that clears it.
// Only a player who takes a place counts against a top-X cut, so a place a
// withdrawal frees goes to the next player below.
//
// `grantedEntryIds` names the players a player meeting has already let into the
// next phase. A withdrawn player is passed over and stamped — the cut is not
// theirs to fail — UNLESS their entry was granted AND they still clear the
// boundary; then they hold their place, nothing is backfilled into it, and they
// stay unstamped so a reinstate returns them to play. Pass an empty set when no
// meeting has frozen anything and every withdrawal frees its place.
//
// Can return fewer than two qualifiers (a points bar nobody cleared, or a field
// thinned by withdrawals); callers decide whether that ends the tournament or
// is an error. When held places are what shrank the field, `heldPlaces` names
// the withdrawn players whose reinstatement would fill it back up.
async function standingsCutoffPartition(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
  grantedEntryIds: ReadonlySet<Id<"tournamentRegistrations">>,
): Promise<CutoffPartition> {
  const standings = await standingsInRankOrder(ctx, roundId);
  const registrations = await mapAsyncInBatches(
    standings,
    DATABASE_IO_BATCH_SIZE,
    async (standing) => await ctx.db.get(standing.playerId),
  );
  const qualifiers: Doc<"tournamentRegistrations">[] = [];
  const droppedNonQualifiers: Doc<"tournamentRegistrations">[] = [];
  const heldPlaces: Doc<"tournamentRegistrations">[] = [];
  let placesTaken = 0;
  standings.forEach((standing, index) => {
    const registration = registrations[index];
    if (registration?.entryStatus !== "confirmed") {
      return;
    }
    if (
      registration.participationStatus !== "active" &&
      registration.participationStatus !== "dropped"
    ) {
      // Already eliminated or disqualified: their record stands, and neither
      // state is reinstatable into active play.
      return;
    }
    const missesCut =
      cutoff.kind === "top_X_players"
        ? placesTaken >= cutoff.playerCount
        : standing.matchPoints < cutoff.matchPoints;
    if (registration.participationStatus === "dropped") {
      if (missesCut || !grantedEntryIds.has(registration._id)) {
        // No place to hold — either nothing granted them one, or the boundary
        // has moved past them. The cut passes over them and, per the stamping
        // invariant, records the elimination so a reinstate cannot walk them
        // into a phase they do not belong in.
        droppedNonQualifiers.push(registration);
        return;
      }
      // Granted an entry and still inside the boundary: the place stays
      // occupied and unstamped, so nothing backfills it and reinstating
      // returns them to play.
      heldPlaces.push(registration);
      placesTaken += 1;
      return;
    }
    if (!missesCut) {
      qualifiers.push(registration);
    }
    placesTaken += 1;
  });
  return { qualifiers, droppedNonQualifiers, heldPlaces };
}

const NO_GRANTED_ENTRIES: ReadonlySet<Id<"tournamentRegistrations">> =
  new Set();

// Applies a phase's configured cutoff to the phase-final round's standings with
// no entry field frozen yet: the field freezes at pairing time, so nothing
// holds a place for a player who has already withdrawn. A drop after the round
// completed therefore hands their place to the next player below them even when
// the standings still rank them above the boundary, and they keep an
// elimination record. (Once the next phase's player meeting has frozen the
// field, cutoffPartitionForNextPhase routes elsewhere and a granted entry can
// survive a withdrawal.)
export async function cutoffPartition(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
): Promise<CutoffPartition> {
  return await standingsCutoffPartition(
    ctx,
    roundId,
    cutoff,
    NO_GRANTED_ENTRIES,
  );
}

// Who survives a phase's configured cutoff, judged against the phase-final
// round's standings.
export async function cutoffQualifiers(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
) {
  return (await cutoffPartition(ctx, roundId, cutoff)).qualifiers;
}

// While a cutoff phase's player meeting is live its seats are the authoritative
// entry snapshot for the next phase, and they draw the cut boundary for both
// sides of the partition — no standings boundary is computed at all. Seated
// players qualify (live registration status still removes a dropped qualifier
// from the entering field), while an unseated player cannot be backfilled after
// the meeting is underway — so a withdrawn player misses the cut exactly when
// they hold no seat, even if the live standings would now place them above the
// boundary. That keeps a reinstate after pairing consistent with one made
// during the meeting: unseated players end up eliminated either way, seated
// ones return to play.
//
// Every seated withdrawal keeps its place here, which is the widest form of the
// exception described in the model note above: the standings the seats were
// drawn from still stand, so a seat still proves the player belongs in the
// field. Once a rewind throws those standings away that stops being true and
// supersededMeetingCutoffPartition re-draws the boundary instead.
//
// Because the seats alone decide both sides, this partition never reads the
// phase-final standings: rank is irrelevant to it, so the withdrawn side comes
// straight from the tournament's confirmed+dropped index range instead of a
// registration get per standings row.
async function meetingCutoffPartition(
  ctx: QueryCtx,
  phase: Doc<"tournamentPhases">,
): Promise<CutoffPartition> {
  const seats = await meetingSeatRows(ctx, phase._id);
  const seated = await mapAsyncInBatches(
    seats,
    DATABASE_IO_BATCH_SIZE,
    async (seat) => await ctx.db.get(seat.registrationId),
  );
  const qualifiers = seated.filter(
    (registration): registration is Doc<"tournamentRegistrations"> =>
      registration?.entryStatus === "confirmed" &&
      registration.participationStatus === "active",
  );
  // A seated withdrawal holds its place (see the model note): dropped, so a
  // reinstate would return them to the seat they still own.
  const heldPlaces = seated.filter(
    (registration): registration is Doc<"tournamentRegistrations"> =>
      registration?.entryStatus === "confirmed" &&
      registration.participationStatus === "dropped",
  );
  const seatedIds = new Set(seats.map((seat) => seat.registrationId));
  const dropped = await droppedRegistrations(ctx, phase.tournamentId);
  const droppedNonQualifiers = dropped.filter(
    (registration) => !seatedIds.has(registration._id),
  );
  return { qualifiers, droppedNonQualifiers, heldPlaces };
}

// A rewind reopens the round the cut was drawn from and deletes its standings,
// but the next phase's meeting is over and its seats stay on disk — the rewind
// stamps the phase's meeting "superseded" to say exactly that. Taking those
// seats verbatim would let the snapshot outrank the very results the organizer
// rewound in order to correct, so the boundary is re-drawn from the corrected
// standings and the snapshot keeps only the one thing standings cannot express:
// an entry the meeting already granted.
//
// A granted entry is therefore a tie-breaker, not a guarantee. It protects a
// seated player who withdrew and whose corrected rank still clears the boundary
// — their place is held rather than backfilled and no elimination is recorded.
// It does not protect a seat holder the correction pushed below the boundary,
// withdrawn or not: their seat was drawn from standings now known to be wrong,
// so the corrected cut decides, they are stamped like any other non-qualifier,
// and a player the correction promotes enters even though the meeting never
// seated them. See the model note at the top of the file.
async function supersededMeetingCutoffPartition(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
  phaseId: Id<"tournamentPhases">,
): Promise<CutoffPartition> {
  const seats = await meetingSeatRows(ctx, phaseId);
  const grantedEntryIds = new Set(seats.map((seat) => seat.registrationId));
  return await standingsCutoffPartition(ctx, roundId, cutoff, grantedEntryIds);
}

// Routes on the phase's explicit meeting-snapshot status (the state machine
// lives on playerMeetingStatusValidator), which says what the snapshot is
// worth right now:
//
//   undefined      no snapshot — the entry field freezes at pairing time, so
//                  the cut reads the standings (cutoffPartition).
//   "in_progress"  a live meeting — its seats ARE the frozen field and are
//                  taken verbatim (meetingCutoffPartition).
//   "superseded"   rewindLatestRound un-paired the phase's first round and
//                  deleted the standings the seats were drawn from, stamping
//                  this — the boundary must be re-drawn
//                  (supersededMeetingCutoffPartition).
//   "completed"    impossible here: pairing the phase's first round is what
//                  stamps it, in the same patch that sets the phase
//                  "in_progress", and the rewind that undoes that pairing
//                  re-stamps "superseded" — so a next phase (always
//                  "upcoming" at every call site) can never carry it. Reaching
//                  it means a new code path completed a meeting without
//                  pairing or rewound without re-stamping; fail loudly rather
//                  than guess which standings the seats were drawn from.
export async function cutoffPartitionForNextPhase(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
  nextPhase: Doc<"tournamentPhases">,
): Promise<CutoffPartition> {
  switch (nextPhase.playerMeetingStatus) {
    case undefined:
      return await cutoffPartition(ctx, roundId, cutoff);
    case "in_progress":
      return await meetingCutoffPartition(ctx, nextPhase);
    case "superseded":
      return await supersededMeetingCutoffPartition(
        ctx,
        roundId,
        cutoff,
        nextPhase._id,
      );
    case "completed":
      throw new Error(
        "Next phase's player meeting is marked completed but its first round is not paired; a rewind must stamp the snapshot superseded",
      );
  }
}

export async function cutoffQualifiersForNextPhase(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
  cutoff: TournamentPhaseCutoff,
  nextPhase: Doc<"tournamentPhases">,
) {
  return (await cutoffPartitionForNextPhase(ctx, roundId, cutoff, nextPhase))
    .qualifiers;
}

async function meetingSeatRows(ctx: QueryCtx, phaseId: Id<"tournamentPhases">) {
  return await ctx.db
    .query("playerMeetingSeats")
    .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
      q.eq("tournamentPhaseId", phaseId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

async function standingsInRankOrder(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  return await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}
