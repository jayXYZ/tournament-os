# MTR research: rematch avoidance, byes, disqualification tiebreakers, single-elim walkovers

Primary-source research against the current official Magic: The Gathering Tournament
Rules (MTR) and Infraction Procedure Guide (IPG), answering four rule questions for the
tournament engine. Every claim below is labeled as one of: **explicit** (the text says
it), **implied** (a reasonable reading of the text), or **silent** (the documents do not
specify it — a finding in itself).

## Documents worked from

| Document                                                               | Revision                                            | Source                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magic: The Gathering Tournament Rules (MTR)                            | Effective **February 27, 2026** (current per WPN)   | [media.wizards.com PDF](https://media.wizards.com/ContentResources/WPN/MTG_MTR_2026_Feb27_EN.pdf), linked from [WPN Rules and Documentation](https://wpn.wizards.com/en/rules-documents) |
| Magic Infraction Procedure Guide (IPG)                                 | Effective **September 23, 2024** (latest published) | [media.wizards.com PDF](https://media.wizards.com/ContentResources/WPN/MTG_IPG_2024Sep23_EN.pdf)                                                                                         |
| MTR historical comparison                                              | April 15, 2024                                      | [media.wizards.com PDF](https://media.wizards.com/ContentResources/WPN/MTG_MTR_2024_Apr15.pdf)                                                                                           |
| MTR historical comparison                                              | March 27, 2015                                      | [mirror PDF](https://hudecekpetr.cz/other/rulebooks/mtr-2015-03-23.pdf) _(mirror)_                                                                                                       |
| DCI Universal Tournament Rules (UTR)                                   | June 20, 2007                                       | [mirror PDF](https://users.pfw.edu/buldtb/private/fwgg/mtg/pdfs/DCI_UTR.pdf) _(mirror)_                                                                                                  |
| WotC "Swiss-Style Pairing System Basics" (scorekeeper aid F.1.1/F.1.2) | Updated **October 7, 1999**                         | [mirror PDF](https://mjmj.info/data/obsolete/other/Swiss_Pairings.pdf) _(mirror; obsolete official document)_                                                                            |
| Magic Judges Forum, "Pairing Algorithm" (topic 8245)                   | community discussion, L5 judge participation        | [apps.magicjudges.org](https://apps.magicjudges.org/forum/topic/8245/) _(secondary, judge program)_                                                                                      |

Headline meta-finding: **the modern MTR does not contain a Swiss pairing procedure at
all.** MTR 10.4 names the algorithm without defining it, and no MTR revision checked
(2015, 2024, 2026) nor the 2007 UTR contains rematch-avoidance or bye-assignment rules.
Those details live only in obsolete 1999-era WotC documents, in Wizards' pairing
software behavior, and in judge-program convention. A senior judge in the forum thread
above states it directly: _"There have not been any official statement of the pairings
policy and algorithm for a very long time. You certainly will not find it in the policy
documents."_ (secondary source).

## Summary

| #   | Question                | One-line answer                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Rematch avoidance scope | **MTR is silent** — no rematch-avoidance rule exists in the current MTR; the only pairing-scope rule is MTR 7.6's draft-pod restriction. Whole-Swiss-portion avoidance is judge/software convention, not MTR text.                                                                                                                                                                                           |
| 2   | Bye assignment          | **MTR is silent** on who gets the bye; it only defines a bye's value (Appendix C: a 2–0 match win). The obsolete 1999 WotC procedure gives it to the leftover player after random within-match-point-group pairing (effectively random within the lowest bracket). A one-bye-per-player cap appears in **no** official document found.                                                                       |
| 3   | DQ and tiebreakers      | The "removed... do not take up a place in the standings" quote is **IPG 1.1 (Disqualification), not the MTR**. Nothing removes a DQ'd player's completed results; MTR Appendix C computes tiebreakers from opponents actually faced and worked examples include dropped players — implying prior results keep feeding OMW%/OGW%. Explicit DQ-tiebreaker statement: absent.                                 |
| 4   | Single-elim walkover    | MTR 2.10 (explicit): after a cut, no replacement advances; the uncontested match is recorded as a **bye**, and Appendix C defines a bye as a 2–0 match win. A no-show who hasn't dropped is instead handled as an IPG 3.1 Tardiness **Match Loss**. Final placement of the departed player: MTR silent for drops (implied: they keep their standing); IPG explicit for DQs (everyone below moves up a spot). |

---

## 1. Rematch avoidance scope

### What the MTR explicitly says

The entire pairing specification in the current MTR is one sentence naming the
algorithm, plus one modification for draft:

> "Unless otherwise announced, tournaments are assumed to follow the Swiss pairing
> algorithm. Some tournaments may proceed to single-elimination playoff rounds between
> the top 2, 4, or 8 (or other number) players after the Swiss rounds are over. The
> Swiss pairing algorithm is modified in booster draft tournaments as explained in
> section 7.6."
> — MTR §10.4 "Pairing Algorithm" (Feb 27, 2026, p. 44)

The draft-pod modification (the "paired within their draft pod" rule the question asks
about) is:

> "Players within a pod may play only against other players within that pod. In Regular
> Rules Enforcement Level tournaments, the Tournament Organizer may elect to lift this
> restriction. This must be announced before the tournament starts."
> — MTR §7.6 "Draft Pod Assembly" (Feb 27, 2026, p. 38)

### What the MTR is silent on

**The MTR contains no rematch-avoidance rule.** The strings "rematch", "already
played", "same opponent" (in a pairing sense) do not appear anywhere in the Feb 27,
2026 MTR, nor in the Apr 15, 2024 or Mar 27, 2015 revisions, nor in the 2007 UTR. The
MTR therefore cannot answer whether rematch avoidance is scoped per event, per day, or
per format segment — it never establishes rematch avoidance in the first place.

### What convention says (secondary sources, labeled as such)

From the Magic Judges Forum "Pairing Algorithm" thread (L5 judges; describing the de
facto standard implemented by Wizards' pairing software):

- _"never pair two players twice during the Swiss"_ (Scott Marshall, L5) — i.e. the
  convention scopes avoidance to the **entire Swiss portion of the event**, across days
  and across format changes, not per segment.
- If two players in the same score bracket have already played, both are paired down;
  the only accepted exception is when a player has already faced every available
  opponent.

### Reading for the engine

- Explicit MTR constraints on pairing are exactly two: Swiss by match points (by name
  only) and, in draft segments, pod-only pairing (MTR 7.6). At a mixed-format event the
  pod restriction is the _only_ MTR-mandated pairing scope: limited rounds pair within
  the pod regardless of what happened in constructed rounds.
- Whole-Swiss rematch avoidance (across days/formats) is the judge-program and
  software convention and a safe default to implement, but if it ever conflicts with
  the pod restriction, MTR 7.6 is the normative text and wins: pod-mates who somehow
  already played must still be paired inside the pod.
- The MTR neither forbids nor permits cross-format rematches in as many words — it is
  silent.

---

## 2. Bye assignment with an odd number of players

### What the MTR explicitly says

The current MTR defines only what a bye is _worth_, never who _receives_ it:

> "When a player is assigned a bye for a round, they are considered to have won the
> match 2–0. Thus, that player earns 3 match points and 6 game points. A player's byes
> are ignored when computing their opponents' match-win and opponents' game-win
> percentages."
> — MTR Appendix C "Byes" (Feb 27, 2026, p. 53)

> "Players receiving byes are considered to have won the match."
> — MTR Appendix C "Match Points" (Feb 27, 2026, p. 51)

Appendix E acknowledges _awarded_ (pre-assigned) byes only for round-count purposes:

> "In tournaments where awarded byes are used, each player with a 1-round bye should
> count as 2 players, each player with a 2-round bye should count as 4 players, and
> each player with a 3-round bye should count as 8 players"
> — MTR Appendix E (Feb 27, 2026, p. 55)

### What the MTR is silent on

- Who receives the odd-player bye (random vs. lowest-ranked vs. anything else).
- Any cap on how many byes one player may receive.

### Historical official procedure (obsolete document, mirror)

WotC's scorekeeper aid "Swiss-Style Pairing System Basics" (F.1.1, updated October 7,
1999; official WotC document, mirrored at mjmj.info):

> "1. Pair players randomly for the first round by shuffling the note cards. ... If you
> have an odd number of players, the player remaining once pairings are completed
> receives a bye, equalling two game wins (6 game points) and one match win (3 match
> points)."

> "3. For all subsequent rounds after the first, pair players with the same match
> points against each other randomly. (If there is an odd number, match one player from
> that group with a person from the group with the next-highest match points.) Do not
> use tiebreakers when pairing between rounds."

> "4. Continue these match-point based pairings until you get to the bottom of the
> list. If you have one player left at the bottom of the list, that player receives a
> bye."

Reading: because within-group pairing is random and tiebreakers are explicitly not
used, the leftover bottom-of-list player is effectively **a random player in the lowest
match-point bracket** — not the lowest-_ranked_ player (rank implies tiebreakers, which
step 3 forbids using).

### The one-bye constraint

The widely implemented rule "a player who has already received a bye should not receive
another" appears in **no official Wizards document** located in this research — not the
MTR (any revision), IPG, UTR, or the 1999 procedure. It is Wizards' pairing-software
behavior and community convention (asserted in judge/community forums). If the engine
implements it — and it should, to match universal practice — the spec citation must be
"software/community convention," not the MTR.

---

## 3. Disqualification and tiebreakers

### Correction: the standings quote is IPG, not MTR

The quote the project already carries lives in the **IPG**, under §1.1 "Definition of
Penalties," subsection "Disqualification" (Sep 23, 2024, p. 4) — not in MTR section 1.x.
The current MTR's only DQ text is MTR §5.1's "All disqualifications are subject to DCI
review and further penalties may be assessed." Full IPG passage:

> "When this penalty is applied, the player loses their current match and is dropped
> from the tournament. If a player has already received prizes at the time they are
> disqualified, that player may keep those prizes but does not receive any additional
> prizes or awards they may be due.
>
> When a player is disqualified during a tournament, they are removed from the
> tournament and do not take up a place in the standings. This means that all players
> in the tournament will advance one spot in the standings and are entitled to any
> prizes the new standing would offer. If the Disqualification takes place after a cut
> is made, no additional players advance in place of the disqualified player although
> they do move up a spot in the standings. For example, if a player is disqualified
> during the quarterfinal round of a Magic Tabletop Mythic Qualifier, the former 9th
> place finisher does not advance into the single elimination top 8, but they do move
> into 8th place in the standings."
> — IPG §1.1 "Disqualification" (Sep 23, 2024, p. 4)

Note what this text does and does not do: it removes the **player** from the
tournament and the standings, and it costs them their **current** match ("loses their
current match"). Nothing in the IPG or MTR expunges their previously completed match
results.

### What MTR Appendix C explicitly says about opponents' percentages

> "A player's opponents' match-win percentage is the average match-win percentage of
> each opponent that player faced (ignoring those rounds for which the player received
> a bye). Use the match-win percentage definition listed above when calculating each
> individual opponent's match-win percentage."
> — MTR Appendix C "Opponents' match-win percentage" (Feb 27, 2026, p. 52)

The only exclusion is byes. There is no carve-out for opponents who dropped or were
removed. And the match-win-percentage section's worked example is _built around_
players who left mid-event:

> "These three players competed in an 8-round tournament, although only the first
> player completed all rounds."
> [table rows:] "5-2-1 — 16 — 8 — 16/(8*3) = 0.667" · "1-3-0, then withdraws — 3 — 4 —
> 3/(4*3) = 0.25, so 0.33 is used." · "3-2-0, including a first-round bye, then
> withdraws — 9 — 5 — 9/(5\*3) = 0.60"
> — MTR Appendix C "Match-win percentage" (Feb 27, 2026, p. 51)

### Explicit / implied / silent

- **Explicit:** dropped players' match-win percentages are still computed (over rounds
  actually played, with the 0.33 floor). The only reason Appendix C computes a
  percentage for a dropped player is for use in _former opponents'_ OMW% — those
  players play no further rounds themselves.
- **Implied:** a disqualified player is "dropped from the tournament" (IPG); the MTR
  treats them like any other departed opponent for tiebreakers, so their completed
  results continue to feed former opponents' OMW%/OGW%. Their DQ'd current match is a
  match loss and counts as such.
- **Silent:** neither the MTR nor the IPG contains a sentence explicitly addressing
  disqualified players and tiebreakers. Removal "from the standings" is about final
  placement and prizes, not about deleting match history — but that distinction is a
  reading, not a quote.

Engine consequence: on DQ, keep all completed match results in the tiebreaker
computation exactly as for a drop, record the in-progress/current match as a loss,
exclude the player from the published standings, and shift everyone below up one place.

---

## 4. Single-elimination walkover

### Opponent has dropped before the match — recorded as a bye

> "If a player drops from a tournament after a cut has been made, no other player is
> advanced as a replacement. If the remaining part of the tournament is single
> elimination, the highest ranked remaining player receives a bye for the next round
> instead."
> — MTR §2.10 "Dropping from a Tournament" (Feb 27, 2026, p. 12)

So the MTR's mechanism is explicitly a **bye**, not a played match, and no 9th-place
player back-fills the bracket. The only definition of a bye's recorded value anywhere
in the MTR is Appendix C's:

> "When a player is assigned a bye for a round, they are considered to have won the
> match 2–0."
> — MTR Appendix C "Byes" (Feb 27, 2026, p. 53)

**Implied:** a bracket walkover is recorded as a bye that counts as a 2–0 match win.
**Silent:** the MTR never states a game score specifically for playoff byes (Appendix C
is a tiebreaker appendix, and tiebreakers are moot in single elimination); 2–0 is the
only recording rule the documents offer.

Wording history worth knowing (the recipient changed between revisions):

- MTR Mar 27, 2015, §2.10: "If a player drops from a tournament after a cut has been
  made, such as a cut to the top 8 playoff in a Magic Pro Tour Qualifier, no other
  player is advanced as a replacement. **That player's opponent** receives a bye for
  the round."
- MTR Apr 15, 2024, §2.10: "...no other player is advanced as a replacement. **The
  highest ranked remaining player** receives a bye for the round instead."
- Current (Feb 27, 2026) keeps the 2024 recipient and adds the single-elimination
  qualifier quoted above.

Read literally, the current text re-awards the bye to the highest Swiss seed remaining
rather than to the departed player's scheduled opponent — i.e. it implies re-pairing
the bracket around the hole rather than a walkover for the scheduled opponent. The MTR
does not elaborate, and the 2015 text shows the older opponent-gets-the-walkover rule.
An engine should treat "who gets the uncontested win" as: scheduled opponent under
2015-era rules and common practice, highest-ranked remaining player under the current
text as written. Flagging this divergence is the finding; the current normative text is
the 2024/2026 wording.

### Opponent is absent but has NOT dropped — Tardiness match loss, not a bye

> "If a player does not show up for their match, they will be automatically dropped
> from the tournament unless they report to the Scorekeeper."
> — MTR §2.10 (Feb 27, 2026, p. 12)

> "Upgrade: A player not in their seat 10 minutes into the round will receive a Match
> Loss and will be dropped from the tournament unless they report to the Head Judge or
> Scorekeeper before the end of the round."
> — IPG §3.1 "Tournament Error — Tardiness" (Sep 23, 2024, pp. 15–16); the base penalty
> is a Game Loss "issued as soon as the round begins" (downgradable to a Warning within
> the first minute).

So a bracket no-show is a **penalty-awarded match win** for the present player, not a
bye. **Silent:** no document specifies the game score to record for a
tardiness/penalty-awarded match (the customary scorekeeper entry is 2–0, but that is
convention; MTR Appendix C only says "Unplayed games are worth 0 points").

Related explicit rule: "In single-elimination rounds, matches may not end in a draw."
— MTR §2.4 (Feb 27, 2026, p. 10).

### How the departed player places

- **Voluntary drop — MTR is almost entirely silent.** Explicit: a player who drops
  before round 1 "is considered to have not participated in the tournament and will not
  be listed in the finish order" (MTR §2.10). Implied by that sentence's scoping: a
  player who drops _later_ — including from a bracket — remains in the finish order at
  whatever standing their results give them; nothing advances a replacement into the
  bracket. No text assigns a specific final place (e.g. "loses the match they
  walked over") to a bracket dropper.
- **Disqualification — explicit (IPG §1.1):** the player is removed and takes no place
  in the standings; every player below advances one spot; after a cut, no one back-fills
  the bracket, but 9th place still becomes 8th in the standings (quarterfinal example
  quoted in section 3 above).

---

## Source links

- MTR, effective Feb 27, 2026 (current): https://media.wizards.com/ContentResources/WPN/MTG_MTR_2026_Feb27_EN.pdf
- WPN Rules and Documentation (lists current MTR): https://wpn.wizards.com/en/rules-documents
- IPG, effective Sep 23, 2024 (current): https://media.wizards.com/ContentResources/WPN/MTG_IPG_2024Sep23_EN.pdf
- MTR, effective Apr 15, 2024 (historical): https://media.wizards.com/ContentResources/WPN/MTG_MTR_2024_Apr15.pdf
- MTR, effective Mar 27, 2015 (historical, mirror): https://hudecekpetr.cz/other/rulebooks/mtr-2015-03-23.pdf
- DCI Universal Tournament Rules, Jun 20, 2007 (historical, mirror): https://users.pfw.edu/buldtb/private/fwgg/mtg/pdfs/DCI_UTR.pdf
- WotC "Swiss-Style Pairing System Basics", Oct 7, 1999 (obsolete official doc, mirror): https://mjmj.info/data/obsolete/other/Swiss_Pairings.pdf
- Magic Judges Forum, "Pairing Algorithm" topic 8245 (secondary): https://apps.magicjudges.org/forum/topic/8245/
