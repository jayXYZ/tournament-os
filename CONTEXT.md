# Tournament OS — Competitive Engine

Shared language for the tournament engine: pairing, scoring, standings, and
progression. The Magic: The Gathering Tournament Rules (MTR) are the normative
standard — where this glossary does not record a deliberate deviation, MTR
behavior is the intended behavior.

## Language

### Scoring and tiebreakers

**Match Points**:
The primary ranking value: 3 for a match win or Bye, 1 for a match draw, 0 for
a match loss. Fixed platform-wide across all formats.
_Avoid_: score

**Game Points**:
The per-game value feeding percentage tiebreakers: 3 for a game win, 1 for a
game draw, 0 for a game loss.

**Match-Win Percentage (MWP)**:
A player's match points divided by the total match points possible in the
rounds they played (3 × rounds), floored at 0.33. Only ever an input to an
opponent's tiebreakers — never ranks the player directly.

**Game-Win Percentage (GWP)**:
A player's game points divided by the total game points possible in the games
they played (3 × games), floored at 0.33. Drawn games count toward both sides
of the division.

**Tiebreakers**:
Standings order is decided by, in order: Match Points, Opponents' Match-Win
Percentage, Game-Win Percentage, Opponents' Game-Win Percentage. A remaining
perfect tie is broken by a random value fixed per player for the tournament,
so recomputation never reorders it.

**Bye**:
An awarded round with no opponent, counted as a 2–0 match win: 3 match points
and 6 game points. A player's byes are ignored when their percentages feed an
opponent's tiebreakers. The bye goes to the lowest-ranked player who has never
had one; second byes exist only once every player in the field has had one.
(Our rule — the MTR is silent on assignment.)

**Rematch Avoidance**:
No two players are paired against each other twice across all of a
tournament's Swiss rounds, in any phase; unavoidable rematches are minimized,
never a pairing failure. Pod-play phases (draft pods, not Swiss) are exempt.
(Our rule — the MTR is silent on rematches.)

**Reported Result**:
A match result entered by a player or organizer. It counts immediately toward
standings and round completion; there is no opponent-confirmation step, and
disputes are resolved by organizer override.
_Avoid_: confirmed result

### Structure

**Phase**:
One stage of a tournament with its own pairing structure (Swiss or single
elimination today; pod play later). A tournament is a short ordered list of
phases; a single-elimination phase is always the last, because it ends with
one player.

**Cut**:
A phase's final act: eliminating every player not moving on and handing the
surviving field to the next phase — the top N players, or everyone clearing a
match-point bar, regardless of what the next phase is. Between Swiss phases
the default is no cut; into a single-elimination phase the default is a top-N
cut.
_Avoid_: top-8 cut (as a distinct concept)

**Bracket**:
A single-elimination phase's structure: the smallest power of two that fits
the entering field, standard-seeded (1v8, 4v5, 2v7, 3v6 generalized) from the
previous phase's final standings — or by the tournament's random seed when it
is the first phase. A short field never skips the phase: the highest seeds
receive first-round Byes. A one-player field is never played; the tournament
completes instead.

**Rewind**:
Un-pairing the current round: available only while that round has no recorded
non-bye result, and it reopens exactly the previous round. Correcting rounds
that were actually played is a different (future) mechanism, and a completed
tournament is final.

**Round Timer**:
A shared informational clock for a round. It forces nothing: rounds can run
without one, and expiry never changes a result or blocks reporting.

**Power Pairing**:
Pairing the final Swiss round of a phase within each match-point bracket in
tiebreaker order instead of randomly. A deliberate MTR deviation; on by
default.

### Participation

**Entry Status**:
A registration's admission state (pending, waitlisted, confirmed, cancelled,
rejected). Independent of competitive state.

**Participation Status**:
A confirmed player's competitive state (active, dropped, eliminated,
disqualified).

**Drop**:
A player's exit from the tournament, voluntary or organizer-recorded. Their
record freezes and keeps feeding former opponents' tiebreakers. A drop during
the player's own unfinished match is a Concession of that match.
_Avoid_: withdrawal, quit

**Concession**:
A match loss taken by a player who concedes (or drops) during their own
unfinished match; the opponent wins the match.

**Walkover**:
The uncontested match win awarded to a bracket player whose scheduled opponent
has left the tournament, recorded as a Bye (a 2–0 match win). It always goes
to the scheduled opponent, never to a reseeded player; defeated players are
never revived into a bracket slot, and walkovers may chain. The departed
player keeps the placement of the seat they reached.
_Avoid_: loser revival, loser advancement

**Disqualification (DQ)**:
Removal from the tournament and from the standings entirely: every
lower-ranked player advances one place. A DQ after a cut advances standings
placements only — nobody is added to the bracket in the DQ'd player's place.
The player's completed matches remain on record, visible and feeding former
opponents' tiebreakers; the tournament stays on their profile without a
placement.
_Avoid_: ban
