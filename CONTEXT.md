# Tournament OS — Competitive Engine

Shared language for the tournament engine — pairing, scoring, standings, and
progression — plus the container tier above it (conventions and the events
they hold). The Magic: The Gathering Tournament Rules (MTR) are the normative
standard — where this glossary does not record a deliberate deviation, MTR
behavior is the intended behavior.

Scope: the competitive engine only. Payments, organizations, and decklists
are separate domains — see `docs/payments.md` and the schema. Entries marked
_Planned_ describe designed-but-unbuilt rules that currently have no writer
in code; everything else describes shipped behavior.

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
perfect tie is broken by a random value fixed per player for the tournament
(derived from the tournament's seed), so recomputation never reorders it.

**Bye**:
An awarded round with no opponent, counted as a match win at the Match
Structure's required game wins to zero (2–0 in best-of-3: 3 match points and
6 game points). A player's byes are ignored when their percentages feed an
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
disputes are resolved by organizer override. Intentional draws are not a
distinct kind of result — they are recorded as ordinary drawn matches.
_Avoid_: confirmed result

**Awarded Result**:
A match outcome recorded without play: Byes, Walkovers, Concessions,
Forfeits, No-Shows, DQ losses, and Missed Rounds. The winning side is
recorded with the Match Structure's required game wins and zero losses (2–0
in best-of-3); a double loss records zero wins for both players.

### Structure

**Phase**:
One stage of a tournament with its own pairing structure (Swiss or single
elimination today; pod play later). A tournament is a short ordered list of
phases; a single-elimination phase is always the last, because it ends with
one player.

**Match Structure**:
A phase's match length — best-of-1, -3, or -5 (default 3), configurable
pre-start like other phase settings. "Best of X" is shorthand for first to
⌈X/2⌉ game wins; a match that ends before either player gets there goes to
whichever player has more game wins, and equal game wins is a match draw
(never allowed in single elimination). Drawn games are always possible and
never count toward X (at most three are recordable per match); non-drawn
games never exceed X.
_Avoid_: best-of-3 as a fixed platform rule

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
Un-pairing the current round: available only while that round has no entered
result — automatic results (a Bye from pairing, a Concession from a drop)
don't count, because the pairing or drop behind them survives the rewind and
nothing anyone entered is destroyed — and it reopens exactly the previous
round. Results are only
ever correctable while their round is open — the active round directly, or
the previous round after a Rewind reopens it (including re-drawing a cut by
rewinding the next phase's first round). Mistakes buried under completed
rounds stand, cut fields are never recomputed after the fact, and a completed
tournament is final.

**Round Timer**:
A shared informational clock for a round. It forces nothing: rounds can run
without one, and expiry never changes a result or blocks reporting.

**Power Pairing**:
Pairing the final Swiss round of a phase within each match-point bracket in
tiebreaker order instead of randomly. A deliberate MTR deviation; on by
default.

**Player Meeting**:
An optional seated gathering an organizer holds before pairing a phase's
first round: the phase's player pool is seated in alphabetical display-name
order, and players see their seat only while the meeting is live. Pairing the
first round completes the meeting; rewinding that round supersedes the seat
snapshot (the cut boundary is re-drawn rather than read from the seats).

### Participation

**Participant**:
The durable competitor identity a registration belongs to, persisting across
tournaments. A Participant is linked to at most one user account; one without
an account is a Guest.
_Avoid_: player identity, competitor record

**Guest**:
A Participant with no linked user account, enrolled with a display name and
optional contact email. Guests hold registrations like any Participant but
have no profile page and take no self-serve actions. (The organizer guest
enrollment surface is planned; today Guests come from test-player seeding.)

**Claim**:
The automatic merge, at sign-in, of every Guest whose contact email matches
the account's verified email into that account holder's Participant. A Guest
whose merge would collide — both identities registered in the same
tournament — stays unclaimed.

**Invite Link**:
A tournament's shared join code, minted and rotated by organizers. Anyone
holding it can view the event page and register (or apply, under approval
mode) whatever the event's visibility — it is the way into a Private event
for players the event has never admitted. Rotating or disabling the link
kills every previously shared copy but never unseats a player it admitted.
It is purely an entry grant: it never overrides an entry decision (a
rejected player stays rejected), capacity, or lifecycle gates, and it opens
nothing before publication.
_Avoid_: invite code (as a distinct concept — the code is the link's
URL-embedded, human-readable form)

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
unfinished match; the opponent wins the match as an Awarded Result. A drop
records the concession immediately — a player who actually finished their
match reports the real result before dropping, and an organizer override
fixes it afterwards otherwise.

**Forfeit** (_Planned_ — lands with judge adjudication, TODO.md §5):
An organizer-recorded match loss awarded against a player without play; the
opponent wins the match as an Awarded Result.

**No-Show** (_Planned_ — lands with judge adjudication, TODO.md §5):
A Forfeit recorded against an absent player. By default it also drops the
player (the organizer can keep them in); both players absent is a double
match loss.

**Late Entry** (_Planned_ — TODO.md §1):
An organizer-only override admitting a player while the first phase is in
progress; players never self-join a started tournament, and capacity still
applies. The player receives a Missed Round loss for every round already
generated (including the open one) and is paired from the next round.

**Missed Round** (_Planned_ — TODO.md §1):
The opponent-less Awarded Result loss (zero game wins, the required game wins
against) a Late Entry player receives for each round they were absent. It
counts toward the player's own Match Points and Game-Win Percentage but, like
a Bye, is excluded when their percentages feed an opponent's tiebreakers.

**Walkover**:
The uncontested match win awarded to a bracket player whose scheduled opponent
has left the tournament, recorded as a Bye (an Awarded Result match win). It
always goes
to the scheduled opponent, never to a reseeded player; defeated players are
never revived into a bracket slot, and walkovers may chain. The departed
player keeps the placement of the seat they reached.
_Avoid_: loser revival, loser advancement

**Disqualification (DQ)** (_Planned_ — the `disqualified` status is reserved
with no writer; lands with judge adjudication, TODO.md §5):
Removal from the tournament and from the standings entirely: every
lower-ranked player advances one place. A DQ after a cut advances standings
placements only — nobody is added to the bracket in the DQ'd player's place.
A DQ during a round records the player's unresolved match as a loss with the
opponent awarded the win; a DQ between rounds carries no match consequence,
an already-reported result is never flipped, and a DQ can only be issued
while the tournament is live.
The player's completed matches remain on record, visible and feeding former
opponents' tiebreakers; the tournament stays on their profile without a
placement.
_Avoid_: ban

**Player View**:
What a player faces in a tournament right now, always exactly one state: the
tournament not yet started, their meeting seat, a wait for pairings or the
next round, no match this round, or their live match.
_Avoid_: current match (as a concept name), play surface

### Containers

**Event**:
A tournament or a convention — the two things that sell entries. The
paid-event rules (fee presence, capacity, refund window, the fee freeze)
apply to both; everything competitive belongs to tournaments alone.
_Avoid_: event as a synonym for tournament specifically

**Convention**:
A first-class umbrella event spanning a date range: it sells Badges, holds
Child Events, and never nests inside another convention. It has the
tournament lifecycle vocabulary but no rounds — an organizer publishes,
starts, and completes it explicitly, and completing a paid convention
releases the badge-fee payout.
_Avoid_: umbrella event, series, meta event

**Badge**:
A Participant's registration for a convention itself. A badge has an Entry
Status but no competitive state. When a convention requires badges, a
confirmed one is the admission gate for self-serve Child Event
registration — an admission gate only: cancelling a badge never revokes
event registrations already made, and organizer actions bypass it.
_Avoid_: convention registration (in UI copy), ticket

**Child Event**:
A tournament held at a convention (`tournaments.conventionId`). It remains a
complete tournament — its own registration, fees, phases, rounds, and
standings — and belongs to at most one convention. Attach and detach only
touch events still in setup or registration; an event that has started keeps
its convention association as history.
_Avoid_: sub-event, satellite
