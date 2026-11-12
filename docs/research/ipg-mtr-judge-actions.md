# IPG/MTR research: complete inventory of judge actions for a judge interface

Primary-source research against the current official Magic: The Gathering Infraction
Procedure Guide (IPG) and Tournament Rules (MTR), cataloguing **every action a judge (or
adjacent tournament official) may need to take or record**, as grounding for the
tournament-os judge interface. Both documents were read cover to cover, including all
appendices. Every claim cites document + section number; short quotes are given where the
exact wording matters. Where a statement is a design reading rather than sourced text it
is flagged as **interpretation**.

## Documents worked from

| Document                                    | Revision                                   | Source                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Magic Infraction Procedure Guide (IPG)      | Effective **September 23, 2024** (current) | `docs/references/MTG_IPG_2024Sep23_EN.pdf` ([media.wizards.com](https://media.wizards.com/ContentResources/WPN/MTG_IPG_2024Sep23_EN.pdf))   |
| Magic: The Gathering Tournament Rules (MTR) | Effective **February 27, 2026** (current)  | `docs/references/MTG_MTR_2026_Feb27_EN.pdf` ([media.wizards.com](https://media.wizards.com/ContentResources/WPN/MTG_MTR_2026_Feb27_EN.pdf)) |

Scope note: the IPG governs **Competitive and Professional REL only**. "Tournaments run
at Regular REL use the Judging at Regular REL document" (IPG Introduction). The JAR was
**not** researched here — it is flagged as a follow-up source at the end.

Companion note: `mtr-pairing-bye-dq-walkover.md` in this folder covers pairing/bye/DQ
standings mechanics in depth; this document only summarizes those where they intersect
with judge actions.

Headline meta-finding for software: the September 23, 2024 IPG changelog says of section
1.2, "**Removed specific details of how penalties are collected and stored, as it varies
depending on the software being used**" (IPG Appendix B). Policy explicitly delegates the
shape of penalty records to the tournament software — the software's data model _is_ the
record.

---

## 1. The core ruling flow (what every recorded ruling must capture)

The IPG defines a single procedure that applies to every infraction: "More significant
violations are addressed by first identifying what infraction applies, then proceeding
with the corresponding instructions" (IPG 1). The generic ruling flow is:

1. **Identify the infraction** (one of the 23 IPG infractions, section 2–4).
2. **Apply the base penalty** (or upgraded/downgraded penalty, with reason).
3. **Apply the prescribed additional remedy/fix**, if the infraction defines one.
4. **Explain everything to the players**: "Any time a penalty is issued, the judge must
   explain the infraction, the procedure for fixing the situation, and the penalty to all
   players involved" (IPG 1.2).
5. **Issue a time extension** if the ruling took more than a minute: "A time extension
   should be issued if the ruling has taken more than a minute" (IPG 1.1, Warning).

Constraints that shape the record:

- **One penalty per error**: "If an error leads to multiple related infractions, only
  issue one with the most severe penalty" (IPG 1.2).
- **One Game Loss at a time**: "If a player would receive multiple Game Losses at the
  same time, they only receive one" (IPG 1.1).
- **Simultaneous Game Losses to both players "are recorded, but do not affect the match
  score"** (IPG 1.1) — the software must be able to record a penalty that has no score
  effect.
- **Not committing to a penalty is also a valid outcome**: a judge may explain the
  correct procedure without issuing a penalty for MTR violations "not covered by one of
  the infractions listed" (IPG 3), and for minor violations quickly handled by the
  players "a judge does not need to intervene" (IPG 1).
- **Intent check**: for any Game Play or Tournament Error, "If the judge believes that
  the error was intentional, they should first consider whether an Unsporting Conduct —
  Cheating infraction has occurred" (IPG 2, IPG 3) — meaning any ruling can escalate into
  an investigation (section 6 below).
- **Reporting up**: "Any penalty of Game Loss or higher should be reported to the Head
  Judge, and it is recommended that only the Head Judge issue penalties of this nature
  (with the exception of Tardiness (3.1) and Decklist Problems (3.4))" (IPG 1.2).

## 2. The complete infraction table (IPG 2–4)

All 23 infractions, with default penalty (confirmed against IPG Appendix A — Penalty
Quick Reference), the defined fix, and upgrade/downgrade paths. "GL" = Game Loss, "ML" =
Match Loss, "DQ" = Disqualification.

| IPG § | Infraction                            | Default                                                                  | Additional remedy / fix (abridged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Upgrades / downgrades                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1   | GPE — Missed Trigger                  | **No Penalty**                                                           | Aura ETB affecting only enchanted permanent: resolve immediately. Delayed trigger undoing a zone change: opponent chooses resolution timing. Missed prior to current phase of previous turn, or expired effect: play on. Otherwise: **opponent chooses** whether the ability goes on the stack (inserted appropriately or on the bottom); no choices that would have been illegal at trigger time. Simple backup if an in-progress action indicated the miss (IPG 2.1).                                                 | **Upgrade to Warning** if the trigger is "usually considered detrimental for the controlling player and they own the card" (IPG 2.1).                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.2   | GPE — Looking at Extra Cards          | Warning                                                                  | "shuffle any previously unknown cards from a deck back into the random portion of the library, then put any previously known cards back in their correct locations" (IPG 2.2). Applied once per sequence of actions.                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.3   | GPE — Hidden Card Error               | Warning                                                                  | Reveal the affected set; **opponent chooses** the previously-unknown cards to set aside / return / treat as revealed; excess to correct location (library: shuffle into random portion unless identity previously known — that many opponent-chosen cards to the original location instead). Simple backup permitted if the card immediately moved to a known location. "If the set of cards that contained the problem no longer exists, there is no remedy" (IPG 2.3). Operate on the smallest set possible.          | **Upgrade to GL** if a face-down morph/disguise card lacks the relevant ability; upgrade waived if the player has a same-ability card in hand, added no unknown cards since, and **self-reported** before forced reveal — they may swap it (IPG 2.3).                                                                                                                                                                                                                                                                                        |
| 2.4   | GPE — Mulligan Procedure Error        | Warning                                                                  | "The player takes an additional mulligan" (IPG 2.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.5   | GPE — Game Rule Violation             | Warning                                                                  | "First, consider a simple backup" (IPG 2.5). Then enumerated partial fixes: untap forgotten permanents (same turn); redo illegal choice for a static ability; perform forced draws/discards/returns; move a known object to its correct zone (only if the wrong zone _is_ the root GRV); choose damage assignment order. "Otherwise, a full backup may be considered or the game state may be left as is" (IPG 2.5). Opponent who reasonably should have noticed gets FtMGS — or GRV too if both responsible (IPG 2.5). | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.6   | GPE — Failure to Maintain Game State  | Warning                                                                  | None.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Never upgraded** (IPG 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3.1   | TE — Tardiness                        | **Game Loss** ("issued as soon as the round begins," IPG 3.1 Philosophy) | "The players are given a time extension corresponding to the length of the tardiness" (IPG 3.1). Judge may also grant a pre-authorized delay of up to 10 minutes for a legitimate task (bathroom, finding replacement cards): no penalty, time extension for time taken; over 10 minutes → Match Loss (IPG 3.1).                                                                                                                                                                                                        | **Upgrade**: "A player not in their seat 10 minutes into the round will receive a Match Loss and will be dropped from the tournament unless they report to the Head Judge or Scorekeeper before the end of the round." **Downgrade**: seated "before 1 minute has elapsed" → Warning (IPG 3.1).                                                                                                                                                                                                                                              |
| 3.2   | TE — Outside Assistance               | **Match Loss**                                                           | None defined. "Spectators who commit this infraction may be asked to leave the venue if they are not enrolled" (IPG 3.2).                                                                                                                                                                                                                                                                                                                                                                                               | **Downgrade to GL** "if the information acquired is information that the player would have access to between games" (IPG 3.2).                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3.3   | TE — Slow Play                        | Warning                                                                  | "In the event that the match exceeds the time limit, two additional turns are added to the number of additional turns played," before end-of-match procedure and after any time extensions; no additional turns if already in extra turns, "though the Warning still applies" (IPG 3.3).                                                                                                                                                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3.4   | TE — Decklist Problem                 | **Game Loss**                                                            | Remove illegal cards from the decklist; alter the decklist to match the actual deck; too few cards: player adds basic Plains/Island/Swamp/Mountain/Forest to reach the minimum ("These changes may be reverted without penalty if the player is subsequently able to locate identical replacements"); companion violations: exchange deck/sideboard cards until legal (IPG 3.4). Penalties "discovered outside the context of the match... are issued at the start of the next match" (IPG 3.4).                        | **HJ discretionary non-issue**: "The Head Judge may choose to not issue this penalty if they believe that what the player wrote on their decklist is obvious and unambiguous," and in Limited for obviously-intended basic land counts (IPG 3.4). HJ may also downgrade if a staff member's erroneous information caused the violation (IPG 1).                                                                                                                                                                                              |
| 3.5   | TE — Deck Problem                     | Warning                                                                  | Locate missing/incorrect cards, reveal to opponent; **opponent chooses** fix timing (now or at next priority) and which missing card replaces each incorrect one; extras shuffled into the random portion; sideboard-origin cards after game 1 chosen at random from main-deck cards in sideboard; companion-restriction fix parallels this. "If the missing card(s) were in a previous or current opponent's deck, issue penalties to both players" (IPG 3.5).                                                         | **Upgrades to GL** (four): pre-sideboard games — deck below registered count or sideboard above registered count found at presentation/deck check; post-sideboard games — deck below format minimum or sideboard above format maximum at presentation/deck check; opponent may have made strategic decisions from a seen sideboard card; more copies of a main-deck card played than registered/allowed "unless all copies of the card are still in the random portion of the library"; companion condition impossible to restore (IPG 3.5). |
| 3.6   | TE — Limited Procedure Violation      | Warning                                                                  | None defined ("Announcements prior to the draft or the specific tournament rules for the format may specify additional penalties," IPG 3.6).                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3.7   | TE — Communication Policy Violation   | Warning                                                                  | "A backup may be considered to the point of the action, not the erroneous communication" (IPG 3.7).                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3.8   | TE — Marked Cards                     | Warning                                                                  | "The player needs to replace the card(s) or sleeve(s) with an unmarked version or, if no sleeves are being used, use sleeves that conceal the markings. If the cards themselves have become marked through play in the tournament, the Head Judge may decide to issue a proxy" (IPG 3.8).                                                                                                                                                                                                                               | **Upgrade to GL** if no replacements found (cards swapped for basic lands, decklist changed — revertable); **Upgrade to GL** "if the Head Judge believes that a deck's owner noticing the pattern of markings would be able to gain substantial advantage" (IPG 3.8).                                                                                                                                                                                                                                                                        |
| 3.9   | TE — Insufficient Shuffling           | Warning                                                                  | "Shuffle the appropriate portion of the deck thoroughly" (IPG 3.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.1   | USC — Minor                           | Warning                                                                  | "The player must correct the problem immediately. Subsequent Unsporting Conduct — Minor infractions, **even for different offenses**, will result in a Game Loss"; an end-of-game repeat GL may be applied to the next game (IPG 4.1).                                                                                                                                                                                                                                                                                  | Escalation to GL on repeat is built into the remedy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4.2   | USC — Major                           | **Match Loss**                                                           | Correct the behavior immediately; end-of-match offense may be applied to the next match. Judges "need to end any match in progress and separate the players"; offender removed from the area to receive the penalty (IPG 4.2).                                                                                                                                                                                                                                                                                          | **Upgrade to DQ** "if the offense was committed with malicious intent, the player displays no remorse, or the offense is repeated at a later time," plus removal from the venue (IPG 4.2).                                                                                                                                                                                                                                                                                                                                                   |
| 4.3   | USC — Improperly Determining a Winner | **Match Loss**                                                           | None defined. If the player knew it was against the rules → Cheating (IPG 4.3).                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.4   | USC — Bribery and Wagering            | **Match Loss**                                                           | None defined. If the player knew → Cheating (IPG 4.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.5   | USC — Aggressive Behavior             | **DQ**                                                                   | "The offender should be asked to leave the venue by the organizer" (IPG 4.5).                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.6   | USC — Theft of Tournament Material    | **DQ**                                                                   | "The offender should be asked to leave the venue by the organizer" (IPG 4.6).                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.7   | USC — Stalling                        | **DQ**                                                                   | None defined.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.8   | USC — Cheating                        | **DQ**                                                                   | None defined; "must be investigated by the judge to make a determination of intent and awareness" (IPG 4.8).                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Repeat-infraction upgrade tracking (software-critical)

The two classes have **different** repeat rules, and both reset daily:

- **Game Play Errors**: "the **third or subsequent** Warning for a Game Play Error
  offense **in the same category** is upgraded to a Game Loss," with the exception of
  Failure to Maintain Game State, "which is never upgraded." "For multi-day tournaments,
  the penalty count for these infractions resets between days" (IPG 2).
- **Tournament Errors**: "A Warning for a Tournament Error offense is upgraded to a Game
  Loss if the player has **already received a Warning** for an offense in the same
  category" — i.e. the **second** TE Warning in a category upgrades. Same daily reset
  (IPG 3).
- **USC — Minor**: any subsequent USC-Minor, even for a different offense, becomes a Game
  Loss (IPG 4.1).

So the software must track, per player, per infraction category, per day: prior Warning
count — and surface the upgrade threshold at ruling time.

## 3. Penalties: definitions and application mechanics

From IPG 1.1 ("Definition of Penalties") and 1.2 ("Applying Penalties"):

- **Warning** — "to alert judges and players involved that a problem has occurred and to
  keep a **permanent record** of the infraction" (IPG 1.1). Explicitly a recordable
  entity.
- **Game Loss** — ends the current game immediately; the infracting player "is considered
  to have lost the game for the purpose of match reporting"; the penalized player
  "chooses whether to play or draw in the next game." "If a Game Loss is issued before
  the match begins, neither player in that match may use sideboards... for the first game
  they play." Applied "immediately if the game is still ongoing, or to the player's next
  game if it is not" (IPG 1.1).
- **Match Loss** — "applied to the match during which the offense occurred unless the
  offender's match has already ended, in which case the penalty will be applied to that
  player's **next match**" (IPG 1.1) — the software needs a pending-penalty concept.
- **Disqualification** — see section 6.
- **Recipients need not be enrolled players**: "Being enrolled in the tournament is not a
  requirement to receive a penalty... spectators, staff, or judges may be enrolled into
  (and dropped from) the tournament in order to receive a penalty" (IPG 1.2). The
  software must support enrolling a person solely to attach a penalty.
- **Penalties survive drops**: "Penalties are still issued even if a player drops from
  the tournament before it would take effect" (IPG 1.2).

## 4. The judge's fix toolkit (cross-infraction procedures)

These are procedures a judge performs (and an interface might log) independent of which
infraction triggered them:

- **Randomizing/shuffling a library as a remedy** (IPG 1.3): determine the non-random
  portion (check with both players; check graveyard/exile/battlefield for manipulation
  cards), shuffle only the random portion, return manipulated cards. "Shuffles performed
  by a judge as part of a remedy are not considered shuffles for game purposes."
- **Backup** (IPG 1.4): "a solution of last resort." "Only the Head Judge may authorize a
  backup. At large tournaments, they may choose to delegate this responsibility to Team
  Leaders." Each action reversed in strict reverse order; unknown drawn cards reversed by
  random selection.
- **Simple backup** (IPG 1.4): "backing up the last action completed (or one currently in
  progress)... A simple backup should not involve any random elements." Permitted inside
  the remedies of 2.1, 2.3, 2.5, 3.7.
- **Judge-error backup**: "If a player clearly acts on erroneous information provided by
  a judge during the game, the Head Judge may consider a backup to the point of the
  action taken, even if that action did not lead to a violation" (IPG 1).
- **Judge shuffling a player's deck on request** (MTR 3.10): if an opponent doubts a
  reasonable randomization effort "the opponent must notify a judge"; "Players may
  request to have a judge shuffle their cards rather than the opponent; this request will
  be honored only at a judge's discretion."
- **Allowing a reversed decision** (MTR 4.8): a judge may allow a player to change a
  just-made play "if that player has not gained any information since taking the action."
- **Loop adjudication** (MTR 4.4): "The judge is the final arbiter of what constitutes a
  loop"; may need to examine hidden information for choice-sustained loops.
- **Day/Night determination** (MTR 4.9): if undeterminable, "the judge should assume it
  is Night"; the mis-tracked state is a CPV where "neither player receives the Warning."
- **Watching a match for slow play on request** (MTR 5.5): "Players may ask a judge to
  watch their game for slow play; such a request will be granted if feasible."
- **Answering questions / information duties** (MTR 1.8, 4.1): answer rules questions and
  provide Oracle wordings; "Judges are encouraged to help players in determining free and
  status information but must avoid assisting players with derived information." Judges
  may honor away-from-table questions and translation requests.
- **Requesting play be made clear** (IPG 1): judges may "request that the players make
  the situation clear, but not assess an infraction."
- **Preempting errors outside the game** (IPG 1): "Judges may intervene to prevent or
  preempt errors occurring outside of a game."
- **Inspecting notes** (MTR 2.11): "Judges may ask to see a player's notes and/or request
  that the player explain their notes."
- **Inspecting/disallowing sleeves mid-match** (MTR 3.11): on a player's request "a
  player may request that a judge inspect an opponent's card sleeves"; the judge may
  disallow them and "may choose to delay any change of sleeves until the end of the
  match."
- **Requesting sleeve replacement** (MTR 3.12): "Judges may request that a player remove
  their current sleeves or replace any of the deck's current sleeves immediately, or
  before the next round."
- **Granting private electronic-device use** (MTR 2.12): "Players wishing to view
  information privately on electronic devices during matches must request permission from
  a judge."

## 5. Head Judge–only and role-gated authorities

Actions the sources reserve to specific roles. An interface should gate these (the
role-gating summary table is at section 12).

**Head Judge only (explicit):**

- **Deviate from the IPG**: "Only the Head Judge is authorized to issue penalties that
  deviate from these guidelines," and only "in significant and exceptional circumstances
  or a situation that has no applicable philosophy" — REL, round, age/experience,
  education desire, and judge certification level "are NOT exceptional circumstances"
  (IPG 1). When deviating, "the Head Judge is expected to explain the standard penalty
  and the reason for deviation" (IPG 1.2) — i.e. a deviation record needs a reason field
  and the standard penalty alongside the issued one.
- **Downgrade for staff-caused errors**: "If a member of the tournament staff gives a
  player erroneous information that causes them to commit a violation, the Head Judge is
  authorized to downgrade the penalty" (IPG 1).
- **Authorize backups** (delegable to Team Leaders at large events) (IPG 1.4).
- **Final ruling on appeals**: "Issuing the final ruling in all appeals, potentially
  overturning the ruling of a floor judge" (MTR 1.7); "Rulings made by the Head Judge or
  designated Appeals Judges are final"; players "may not appeal before the full ruling is
  made by the responding floor judge" (MTR 2.9). At larger Premier events the HJ may,
  "with prior approval," designate **Appeals Judges** (MTR 2.9).
- **Determine that a DQ is warranted** (IPG 1.1; see section 6) and review all cheating
  allegations (MTR 5.1).
- **Issue proxies**: "Players may not create their own proxies; they may only be created
  by the Head Judge who has sole discretion" (MTR 3.4; also MTR 3.3, IPG 3.8).
- **Decline the Decklist Problem penalty** for obvious/unambiguous entries (IPG 3.4).
- **Final authority calls enumerated in the MTR**: acceptable cards for the tournament
  (MTR 3.3); card interpretations, "and they may overrule Oracle if an error is
  discovered" (MTR 3.6); what sleeves are allowed (MTR 3.11); whether a card is marked
  (MTR 3.12); what cards and notes are acceptable (MTR 2.11, IPG 3.2); what may
  represent permanents (MTR 4.7); what constitutes unsporting conduct (IPG 4); time
  limits for the tournament (MTR Appendix B); "final authority in determining corrective
  action for scorekeeping errors" (MTR 1.9).
- **Require deck registration at Regular REL** (MTR 2.7); **perform deck checks at
  Regular REL** (option) (MTR 2.8); **require sealed pool registration/swap** (MTR 7.5);
  **require opponent-shuffling at Regular REL** (MTR 3.10).
- **Direct draft pod assembly** (MTR 7.6, 9.7); **disallow Regular-REL pick review**
  before the first draft (MTR 7.7).
- **Approve re-enrollment of a dropped player** (MTR 2.10; see section 9).
- **Use video replay in rulings** — only the HJ of a World Championship, Pro Tour, or
  Limited Championship, "in their sole discretion"; "Players may not request that a judge
  consult a video replay. Video replays may also be used for investigative purposes at a
  later time" (MTR 2.13).
- **Restrict or forbid electronic devices** (HJ or TO) (MTR 2.12).
- **Temporarily transfer their duties** to any judge (MTR 1.7).
- **Decide abnormal product outcomes** jointly with the TO (MTR 7.4).
- **Recommended sole issuer of Game Loss or higher** except Tardiness and Decklist
  Problems (IPG 1.2).

**Tournament Organizer:**

- Sanctioning, venue, advertising, staffing, materials (MTR 1.6); replace the Head Judge
  "in exceptional circumstances, if the tournament's integrity would be damaged
  otherwise" (MTR 1.7); announce match-win counts and round counts before the event
  (MTR 2.1, 10.2); grant permission for single-elimination prize splits (MTR 5.2);
  announce extra pre-penalty time for tardiness (IPG 3.1); age-restrict Regular REL
  events (MTR 1.4); pool player-supplied Limited product (MTR 7.2); report a tournament
  as "Did Not Occur" when minimums aren't met (MTR 10.1, 10.2); ask DQ'd/aggressive
  offenders to leave the venue (IPG 4.5, 4.6).

**Scorekeeper** (MTR 1.9): see section 11.

## 6. Investigations and the Disqualification procedure

What the documents require to happen (and be recorded) around a DQ:

- **Investigation is a first-class activity**: cheating "must be investigated by the
  judge to make a determination of intent and awareness" (IPG 4.8); "Officials must
  investigate these matters as soon as they are brought to their attention" (IPG 4.2);
  "Officials are expected to investigate potential matters brought their attention as
  soon as possible" (MTR 5.4). "Knowledge of a player's history or skill does not alter
  an infraction, but it may be taken into account during an investigation" (IPG 1).
  Video replay may feed investigations at any event ("at a later time," MTR 2.13).
- **DQ standard of proof**: "Disqualification can occur without proof of action so long
  as the Head Judge determines sufficient information exists to believe the tournament's
  integrity may have been compromised. **It is recommended that the Head Judge's report
  reflect this fact**" (IPG 1.1) — the HJ report is an explicit artifact.
- **Non-players can be DQ'd**: "The recipient of a Disqualification does not need to be a
  player in the tournament. They may be a spectator or other bystander" (IPG 1.1).
- **Effects to apply in software**: "the player loses their current match and is dropped
  from the tournament"; keeps prizes already received but "does not receive any
  additional prizes"; "removed from the tournament and do not take up a place in the
  standings," everyone below advances one spot; after a cut, nobody back-fills the
  bracket but standings still shift (IPG 1.1; quoted in full in the companion note).
- **Team cascade**: "If a player is disqualified from the tournament, the entire team is
  disqualified from the tournament" (MTR 8.2). (Likewise a drop drops the whole team.)
- **External reporting**: "Disqualifications should be reported [to Wizards]. Please
  include the **Wizards Account email address of the disqualified player and that
  player's opponent**" (IPG 1.1). "All disqualifications are subject to DCI review and
  further penalties may be assessed" (MTR 5.1).
- **Player statements**: the current IPG/MTR text does **not** spell out collecting
  written player statements — the Sep 2024 changelog note (IPG Appendix B) shows the
  collection/storage details were deliberately removed as software-dependent. Treat
  "collect statements" as judge-program practice; the sourced requirements are the HJ
  report and the Wizards report with both email addresses.

## 7. Time and match-flow actions

- **Issue a time extension** whenever "a judge pauses a match for more than one minute
  while the round clock is running" (MTR 2.6); rulings over a minute (IPG 1.1); tardiness
  length (IPG 3.1); authorized-task delays up to 10 minutes (IPG 3.1).
- **Deck-check extension formula**: "players are awarded time equal to the time the deck
  check took **plus three minutes**" (MTR 2.6).
- **Feature-match extension**: "equal to three minutes plus time elapsed in the round
  when players reach their table," unless timed separately (MTR 2.6).
- **Turn-based extensions**: "Certain slow play penalties add turns rather than a time
  extension. These additional turns are added to the end-of-match additional turns"
  (MTR 2.6; IPG 3.3).
- **End-of-match procedure** (MTR 2.4): active player finishes their turn, then **five**
  additional turns total (**three** in multi-player team formats like 2HG); "Once time is
  called, no new games should begin"; incomplete game after extra turns is a draw; the
  procedure "does not begin until the end of the time extension."
- **Single-elimination no-draw procedure** (MTR 2.4): highest life total wins the current
  game after extra turns; if tied, play continues with the added state-based action "if a
  player does not have the highest life total, they lose the game."
- **Time limits** (MTR Appendix B): required minimum 40 minutes per match; recommended 50
  (Swiss), 90 (single-elim QF/SF), no limit (final); Limited build/registration timings
  per format (Sealed 20+30, Draft 25, Team Sealed 20+60, Team Draft 40, 2HG variants);
  "In timed rounds, players must wait for the officially tracked time to begin before
  starting their match"; HJ is final authority on time limits but "any deviation from
  these recommendations must be announced prior to and during tournament registration."
- **Draft pick timers** (MTR Appendix B): per-pick countdowns (40s at 15 cards down to
  5s), review periods (60s after pack 1, +30s each subsequent; Rochester 20s layout
  review, 5s picks; 2HG table) — enforced by judges in timed drafts; exceeding pick time
  is a Limited Procedure Violation (IPG 3.6 example B).
- **Concessions and intentional draws** (MTR 2.5): allowed "until the result of a match
  has been recorded"; "If the conceding player won a game in the match, the match must be
  reported as 2-1. Intentional draws where no games were played are always reported as
  0-0-3 in EventLink"; "If a player refuses to play, it is assumed that they have
  conceded the match." Judges enforce that no reward/incentive is attached (Bribery,
  MTR 5.2).
- **Match result recording** (MTR 2.4): "players may not leave the table until the result
  of the match is recorded unless they are doing so to record the result."
- **Result-discrepancy handling**: players must bring "to a judge's attention any
  discrepancies in their tournament match record" (MTR 1.10); corrective action for
  scorekeeping errors is decided by the HJ (MTR 1.9).

## 8. Deck, decklist, and card actions

- **Deck registration** (MTR 2.7): required at Comp/Prof REL; Constructed lists due
  before the tournament, Limited lists "prior to the start of the first round in which
  that player participates"; "Once your decklist has been accepted by a Tournament
  Official it may not be altered"; electronic decklists lock at the submission deadline.
  Players may request to see their own decklist between matches ("honored if
  logistically possible"). Decklists are not public, except at Professional REL events
  where "opponents' decklists will be provided to players" (open decklists) (MTR 2.7).
- **Deck checks** (MTR 2.8): "must be performed at all Competitive and Professional
  Rules Enforcement Level tournaments"; "At least ten percent of all decks should be
  checked over the course of the tournament"; "A full deck check should not be performed
  if a player has drawn an opening hand and potentially made mulligan decisions." The
  interface should track which decks were checked and when (start-of-match vs mid-round
  is distinguished in IPG 3.5's upgrade triggers — "while the deck is presented to the
  opponent for pre-game shuffling or during a deckcheck").
- **Decklist counting**: decklist errors "discovered through decklist counting" are a
  recognized off-match discovery channel with delayed penalty application (IPG 3.4).
- **Sealed-swap misregistration**: Decklist Problem "does not cover errors in
  registration made by another participant prior to a sealed pool swap. Those should be
  corrected at the discretion of the judge" — a no-penalty correction action (IPG 3.4).
- **Proxy issuance** (MTR 3.4): HJ-only; allowed only for cards accidentally
  damaged/excessively worn in the current tournament (or foils with no non-foil
  printing); "a proxy is valid only for the duration of the tournament in which it was
  originally issued"; original kept nearby. Also the Marked Cards remedy (IPG 3.8).
- **Basic-land replacement**: "If a player is required to replace a card in their deck
  and is unable to find a replacement, the player may replace the card with a card named
  Plains, Island, Swamp, Mountain, or Forest of their choice. This also applies to cards
  that are lost and must be replaced to have a legal deck" (MTR 3.3; echoed in IPG 3.4
  and 3.8, both revertable if replacements turn up).
- **Marked cards determination** (MTR 3.12 + IPG 3.8): HJ determines markedness; sleeved
  cards examined in sleeves; judges may order sleeve replacement now or before next
  round; judges are "encouraged to alert players about concerns with marked sideboard
  cards" without a penalty (IPG 3.8).
- **Card legality rulings** (MTR 3.3–3.7, 6.x, 7.x): authorized cards, counterfeit-adjacent
  ("genuine Magic cards"), substitute-card rules for double-faced cards, artistic
  modification limits, banned/restricted lists, snow-basic replacement in Standard
  ("Players must replace them when discovered, but no infraction is committed," MTR 6.3).
- **Sideboard enforcement** (MTR 3.16): face-down presentation, opponent may count at any
  time, return to original composition each match, the no-sideboard rule after a pregame
  Game Loss or pregame intentional draw.

## 9. Player-state and enrollment actions

- **Enroll / registration data** (MTR 1.5): "players must provide a Wizards Account
  and/or a first and last name" for EventLink events.
- **Eligibility screening** (MTR 1.4): DCI-suspended individuals may not play or
  officiate; under-14 parental permission; TO-announced age restrictions; officials who
  have played may not officiate except at listed Regular-REL event types — "If one or
  more tournament officials play in the tournament, it must be run at Regular Rules
  Enforcement Level" (MTR 1.4).
- **Drop a player** (MTR 2.10): any time; before round 1 → not listed in finish order;
  drops must reach the Scorekeeper "before the pairings for the next round are
  generated," else the player is paired; no-shows "will be automatically dropped from the
  tournament unless they report to the Scorekeeper"; repeated/intentional
  no-inform drops "may be the subject of penalties up to and including suspension."
- **Drop with penalty**: Tardiness 10-minute upgrade both penalizes and drops (IPG 3.1);
  DQ drops (IPG 1.1); team drop/DQ cascades (MTR 8.2).
- **Re-enroll a dropped player** (MTR 2.10): "Players who have dropped may reenter a
  tournament at the discretion of the Head Judge," but not into "a portion of the
  tournament that requires a deck built during a construction period that the player
  missed," and "Players may not reenter a tournament after any cut has been made."
- **Post-cut vacancy** (MTR 2.10): no replacement advances; in single elimination "the
  highest ranked remaining player receives a bye" (full analysis in the companion note).
- **Limited drops keep cards** (MTR 2.10): dropped players own cards correctly in their
  possession, "includ[ing] any unopened or partially drafted booster packs."
- **Wrong seat/opponent**: "A player sits at an incorrect table and plays the wrong
  opponent" is a Tardiness example (IPG 3.1, example D) — i.e. mispaired matches are
  handled through the Tardiness infraction; the software should support voiding/fixing a
  mis-played pairing alongside the penalty.
- **Spectator management** (MTR 1.11): spectators must stay "silent and passive"; may
  alert a judge to violations (and at Regular/Comp may pause the match to do so; at
  Professional non-coverage spectators "must not interfere with the match directly");
  "Players may request that a spectator not observe their matches. Such requests must be
  made through a judge. Tournament officials may also instruct a spectator not observe a
  match or matches"; unenrolled Outside Assistance offenders "may be asked to leave the
  venue" (IPG 3.2).
- **Team designations** (MTR 8.2): teams register player positions A/B/C, kept all
  tournament; officials may disallow offensive team names (MTR 8.1).

## 10. Draft and Limited-specific actions

- **Pod assembly**: "players assemble into random drafting circles (called pods) of
  roughly equal size at the direction of the Head Judge. Tournament officials then
  distribute identical sets of boosters to each player" (MTR 7.6; teams: MTR 9.7).
- **Product distribution and stamping** (MTR 7.2): product "received directly from
  tournament officials," new and unopened; equal quantity/type for all; Premier events
  may pre-open to stamp; TO-supplied product pooled and randomly distributed if players
  provide their own.
- **Abnormal product** (MTR 7.4): player must call a judge; "The final decision to
  replace or allow the atypical product is at the discretion of the Head Judge and the
  Tournament Organizer."
- **Wrong card count in pack** (MTR 7.7): "Players who receive an erroneous number of
  cards at any time must immediately notify a judge."
- **Draft procedure enforcement** (MTR 7.7, Appendix B): direction of passing, pick
  timing, face-down passing, no pick review at Comp/Prof, no revealing picks (exception:
  double-faced cards), no notes during drafts (MTR 2.11, 4.6), silence during Comp/Prof
  drafts (MTR 5.6). Violations are Limited Procedure Violations (IPG 3.6).
- **Suspend a player from drafting** (MTR 7.7): a player unable/unwilling to continue
  "is suspended from drafting and must construct a deck from whatever cards they have
  drafted thus far... their picks are skipped and the draft continues with one fewer
  player."
- **Rochester timeout pick** (MTR 8.5): "If a player fails to select a card in the time
  given, a tournament official selects for that player the 'oldest' card remaining from
  the booster pack."
- **Sealed pool registration/swap** (MTR 7.5): HJ-optional procedure — distribute
  boosters, cross-table verification, pool registration by the opposite player, return of
  pools; "Players construct and record decks as normal."
- **Continuous construction announcement** (MTR 7.3): Regular-REL-only option; "The Head
  Judge or Tournament Organizer must inform players if this option is being used prior to
  the start of deck construction."
- **Card version replacement** (MTR 7.2): "Players may ask a judge for permission to
  replace a card with another version of the same card."
- **Land station** (MTR 7.2): TO must announce before registration if not providing
  extra basic lands; may require their return.
- **Misbuilds**: there is no dedicated "misbuild" infraction — a deck not matching the
  registered Limited pool/decklist flows through Decklist Problem / Deck Problem
  (IPG 3.4/3.5), and adding cards to a Sealed pool is a Cheating example (IPG 4.8,
  example F).

## 11. Scorekeeper-adjacent actions (result entry, pairings, standings)

The Scorekeeper "ensures the correct generation of pairings and all other tournament
records throughout the tournament" (MTR 1.9). Duties list, verbatim:

- "Generating correct pairings each round and accurately entering the results of those
  rounds."
- "Generating standings for posting before and after the final Swiss round. Other rounds
  may also be posted at the Head Judge's discretion."
- "Solving all scorekeeping problems that arise in consultation with the Head Judge."
- "Making sure all necessary information is included in the tournament's report."

Plus: "The Head Judge has the final authority in determining corrective action for
scorekeeping errors" (MTR 1.9). The Scorekeeper is also a named report-to target for the
Tardiness 10-minute drop escape ("unless they report to the Head Judge or Scorekeeper,"
IPG 3.1) and for no-show drops and drop requests (MTR 2.10).

Related structural actions the software owns and judges/scorekeepers trigger:

- Round-count announcement and variable-round criteria (MTR 10.2); Appendix E
  required/recommended Swiss round and playoff-size table; awarded-bye player-count
  weighting (MTR Appendix E).
- Playoff seeding and brackets (MTR 10.4): early-advance seeding rules at
  PT/LC/Worlds (locked per round, tiebreaker snapshot "as of the round" they qualify);
  1v8/4v5/3v6/2v7 bracket; draft-table seat-based playoff bracket (1v5, 2v6, 3v7, 4v8);
  "For most Premier Events, the playoff options above are required, not optional."
- Tiebreaker computation (MTR 3.1, Appendix C): match points, OMW%, GW%, OGW%, 0.33
  floor, byes = 2–0 wins ignored in opponents' percentages, unfinished games are draws,
  unplayed games worth 0.
- Participation minimums and "Did Not Occur" reporting (MTR 10.1, 10.2 — TO
  responsibility).
- Publishing: Wizards "reserves the right to publish penalty and suspension information"
  (MTR 1.2) — penalties recorded in software feed an external reporting pipeline.

## 12. Role-gating summary

| Action                                                                   | Floor judge                                                                                                 | Head Judge                                       | Scorekeeper           | TO                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- | ----------------------------- |
| Issue Warnings and infraction rulings with standard fixes                | Yes                                                                                                         | Yes                                              | —                     | —                             |
| Issue Game Loss / Match Loss                                             | Report to HJ; "recommended that only the Head Judge issue" except Tardiness and Decklist Problems (IPG 1.2) | Yes                                              | —                     | —                             |
| Tardiness and Decklist Problem penalties (any severity)                  | Yes (IPG 1.2 carve-out)                                                                                     | Yes                                              | —                     | —                             |
| Deviate from IPG / downgrade for staff error                             | No — "must consult with the Head Judge" (IPG 1)                                                             | Yes (IPG 1)                                      | —                     | —                             |
| Authorize backup                                                         | Only if delegated Team Leader (IPG 1.4)                                                                     | Yes                                              | —                     | —                             |
| Disqualification                                                         | No                                                                                                          | Yes (IPG 1.1, MTR 5.1)                           | —                     | —                             |
| Hear appeals / final ruling                                              | No                                                                                                          | Yes (+ designated Appeals Judges, MTR 2.9)       | —                     | —                             |
| Issue proxy                                                              | No                                                                                                          | "sole discretion" (MTR 3.4)                      | —                     | —                             |
| Waive Decklist Problem for obvious entries                               | No                                                                                                          | Yes (IPG 3.4)                                    | —                     | —                             |
| Marked-card / sleeve / card-acceptability / interpretation final calls   | Inspect and act                                                                                             | Final authority (MTR 3.3, 3.6, 3.11, 3.12)       | —                     | —                             |
| Video replay in a ruling                                                 | No                                                                                                          | HJ of WC/PT/LC only (MTR 2.13)                   | —                     | —                             |
| Time extensions                                                          | Yes (MTR 2.6, IPG 1.1)                                                                                      | Yes                                              | Recorded via software | —                             |
| Enter results / pairings / standings                                     | —                                                                                                           | Final authority on corrections (MTR 1.9)         | Yes (MTR 1.9)         | —                             |
| Drop / no-show drop processing                                           | Via Scorekeeper                                                                                             | Yes                                              | Yes (MTR 2.10)        | —                             |
| Re-enroll dropped player                                                 | No                                                                                                          | "at the discretion of the Head Judge" (MTR 2.10) | Executes              | —                             |
| Replace the Head Judge                                                   | —                                                                                                           | —                                                | —                     | Yes, exceptional (MTR 1.7)    |
| Prize-split permission, round/match-count announcements, "Did Not Occur" | —                                                                                                           | —                                                | —                     | Yes (MTR 5.2, 2.1, 10.1–10.2) |
| Ask offender to leave venue                                              | May request (IPG 3.2)                                                                                       | —                                                | —                     | Yes (IPG 4.5, 4.6)            |

## 13. REL differences relevant to the interface

The IPG applies only at Competitive/Professional; Regular REL uses the **JAR** (IPG
Introduction, MTR 1.12). Differences the MTR itself states:

- Deck registration optional at Regular (HJ may require) (MTR 2.7); deck checks optional
  at Regular (MTR 2.8).
- Continuous construction exists **only** at Regular (MTR 7.3).
- Electronic note-taking allowed at Regular (MTR 2.11, 2.12); online Oracle sources
  allowed at Regular (MTR 2.11).
- "At Regular Rules Enforcement Level, all derived information is instead considered
  free" (MTR 4.1).
- Draft pick review between/during picks allowed at Regular; pod-only pairing may be
  lifted by the TO at Regular (MTR 7.6, 7.7).
- Judges may help players understand the game state at Regular (MTR 1.8).
- Opponent-deck shuffling required at Comp/Prof; HJ option at Regular (MTR 3.10).
- Officials may play only at Regular-REL event types (MTR 1.4).
- Status-information tracking methods "that can easily be accidentally changed (such as
  dice) may not be used" at Comp/Prof (MTR 4.1); game layout rules apply to Comp/Prof
  matches (MTR 4.7).
- Appendix F maps programs to minimum RELs (FNM/Prerelease/Launch Party Regular; RCQ/PTQ/
  RC/Eternal Weekend/Spotlight Day 1 Competitive; PT/Worlds/LC/Spotlight Day 2
  Professional).

**Interpretation**: the judge interface should carry an event-level REL flag that (a)
switches the infraction catalogue (IPG vs JAR), (b) toggles decklist/deck-check features,
and (c) relaxes the Comp/Prof-only enforcement items above.

## 14. Implications for the judge interface (interpretation)

Everything below is derived from what the documents require to be tracked, reported, or
communicated — but the mapping to entities is design interpretation, not sourced fact.

Recordable entities the sources imply:

1. **Ruling / penalty record** — person (player or enrolled non-player), infraction
   (IPG code), penalty issued, standard-vs-deviated penalty + deviation reason (IPG 1,
   1.2), fix applied, upgrade/downgrade applied + which clause, round/game context,
   issuing judge, HJ notification for GL+ (IPG 1.2), deferred-application state ("next
   game"/"next match"/"start of next match", IPG 1.1, 3.4, 4.1, 4.2), and a
   "recorded-but-no-score-effect" flag for simultaneous Game Losses (IPG 1.1). Warnings
   are explicitly "a permanent record of the infraction" (IPG 1.1).
2. **Per-player per-category per-day Warning counters** driving the GPE third-Warning and
   TE second-Warning upgrades and the USC-Minor repeat GL (IPG 2, 3, 4.1), with a
   multi-day reset.
3. **Time extension record** — table/match, minutes (or added turns for Slow Play), cause
   (ruling, deck check + 3 min formula, tardiness, feature match), so the end-of-round
   process knows which matches are still live (MTR 2.6, 2.4).
4. **Deck-check log** — who was checked, when (pre-game vs mid-round), outcome; needed to
   satisfy "at least ten percent of all decks" (MTR 2.8) and to substantiate IPG 3.5
   upgrade triggers.
5. **Decklist store** — submission deadline lock (MTR 2.7), judge-editable with an audit
   trail (fixes in IPG 3.4/3.8 alter the decklist, some "reverted without penalty"
   later), player self-view between matches, Professional-REL open-decklist sharing.
6. **Investigation / DQ report** — narrative HJ report ("It is recommended that the Head
   Judge's report reflect this fact," IPG 1.1), the Wizards report including both
   players' Wizards Account emails (IPG 1.1), the automatic drop + standings-shift +
   prize-freeze effects, team cascade (MTR 8.2), and DCI-review flagging (MTR 5.1).
7. **Appeal record** — floor ruling, HJ (or Appeals Judge) final ruling, upheld/overturned
   (MTR 2.9, 1.7).
8. **Proxy record** — card, reason, HJ issuer, valid-this-tournament-only (MTR 3.4).
9. **Drop/re-enroll ledger** — drop source (voluntary, no-show auto-drop, tardiness
   upgrade, DQ), timing vs pairing generation (MTR 2.10), HJ-approved re-entry with the
   construction-period and post-cut ineligibility checks, repeat no-inform-drop tracking
   for suspension referral (MTR 2.10).
10. **Round clock + end-of-round machinery** — official tracked time (MTR App. B),
    turns-based extensions, extra-turn counts (5/3), single-elim tiebreak procedure
    (MTR 2.4), plus draft pick timers (MTR App. B).
11. **Result entry/correction** — including the mandated encodings: concession after a
    game win reported 2-1, intentional draw 0-0-3 (MTR 2.5); correction workflow with HJ
    final authority (MTR 1.9); result-discrepancy reporting from players (MTR 1.10).
12. **Role model** — Floor Judge / Team Leader (backup delegation) / Appeals Judge / Head
    Judge / Scorekeeper / TO, gating per section 12; multiple simultaneous or
    per-portion Head Judges at Premier events (MTR 1.7); HJ duty transfer (MTR 1.7).
13. **Event configuration** — REL, format(s), match-win count, round count/variable
    criteria announcements, time limits (with the "announced prior to and during
    registration" constraint for deviations), open decklists, continuous construction,
    pod restrictions.

## 15. Open questions and follow-up sources

- **JAR (Judging at Regular REL)** — not researched here; required to build the
  Regular-REL infraction set (the MTR and IPG both point to it: IPG Introduction,
  MTR 1.12, MTR 5.1). Follow-up source.
- **Penalty record format** — deliberately unspecified since Sep 2024 ("varies depending
  on the software being used," IPG Appendix B). Prior IPG revisions and judge-program
  materials (penalty slips) would show conventional fields (round, table, judge,
  infraction, penalty, description); secondary sources if wanted.
- **DQ statement collection** — current documents require only the HJ report and the
  Wizards report with both email addresses (IPG 1.1); the fuller investigation workflow
  (player written statements) lives in judge-program practice, not the IPG/MTR text.
- **Premier fact sheets and the Premier Tournament Invitation Policy** — both can
  override MTR procedures ("the information in the fact sheet takes precedence," MTR
  Introduction; MTR 1.4, 10.3). Out of scope; per-event overrides should be assumed
  possible.
- **Suspended-persons screening** (MTR 1.4) — the DCI suspension list is external; how
  software checks it is unspecified.
- **Comprehensive Rules cross-references** — mulligans (CR 103.4, MTR 2.3) and 2HG
  mulligans (CR 103.4c, MTR 9.4) were not mined; only relevant if the interface scripts
  pregame procedures.
- Both MTR appendices B–F and IPG appendices A–B were fully read; nothing was left
  unmined in the two primary PDFs.
