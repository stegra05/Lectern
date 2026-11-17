# RFD 14 · The quality bar is the marks of unseen papers, then Steffen's own deck

|           |                                                                                   |
| --------- | --------------------------------------------------------------------------------- |
| **State** | decided, measurement ongoing                                                      |
| **Date**  | 2026-11-13, measured 2026-11-14 to 2026-11-17, exam measure decided 2026-11-16    |
| **Code**  | `packages/engine/eval/bench.ts` (exam marks), `eval/refdeck.ts` (reference deck), `eval/blind.ts` (blind sample) |

> **In one breath.** A deck is scored on the marks of past papers its build never saw. Steffen's
> own 636 notes for Entrepreneurship stay as the second measure and as the deck of the blind
> comparison. Form is already fine. Coverage is the gap.

## Decision

**The headline is exam marks.** The newest papers of a course are held back from the build and
read once into knowledge points: one fact a student must know, with the marks it earns. A judge
decides for one point and one card at a time whether the card holds the point, and the score is
the share of the marks the deck holds, counted as the paper pays (a question pays at most its
marks, and of "five of these six" only the best five count). Every engine change that claims
better cards is measured this way, as a paired comparison on the same points.

Why not the reference deck alone: there is one good deck, its 636 notes were chosen from the
very exams the engine also reads, a third of them are not on the slides, and the preset was
shaped on the same course. Past papers exist for most courses, and the held-back ones are
unseen by construction.

**A change passes one gate.** `bench.ts gate` holds the builds of the new code against the
builds of the old and says `better` only when the mean score rose by more than builds of the
same code differ (at 95 percent, with what so few builds ask for: about 6 points with three
builds a side, 4 with five, and 11 with two), and no guard fails: the deck at most 5 percent bigger, the answers at most 10
percent longer, at most 10 percent more calls and tokens written. The guards close the cheap
ways to a higher score, more cards and cards stuffed with several facts, and hold a change to
what a build takes. Calls and tokens written stand in for time: the clock moved by 7 percent
between three builds of the same code, calls by 7 and tokens by 5, and only those two are the
engine's doing. A change that fails a guard is not refused for good. It is a trade, and a trade
is Steffen's to decide, not an agent's.

**Tune on the dev papers, confirm on the test papers.** The four papers of 2022 to 2024 are
the dev set (221 points), the four newest the test set (218 points), and a build for either
reads only the 14 papers before 2022. Work on the engine looks at the dev score. The test score
is read once, when a change is to be accepted. This exam repeats itself: 114 of the dev set's
143 facts are also in the test set. So the test set guards against a slip, not against fitting
this one course; only a second course does that.

**The reference deck stays second.** Steffen's Entrepreneurship deck: 636 vetted notes for 11
slide decks (356 slides), made with a strong model. Its atomic pass took 178 cards to 636 and
the average answer from 59 words to 11.6. The eval exports it from Anki and a judge (Claude
Sonnet since 2026-11-16, Claude Haiku before, spot-checked by hand) decides for each reference
note whether a run has the same fact, only the concept, or nothing. v3.0 is done only after a
blind comparison by a person against this deck
([#137](https://github.com/stegra05/lectern/issues/137)).

## Marks of unseen papers

The test set is the four newest Entrepreneurship papers (Winter 24/25 to Summer 26, 60 marks
each): 218 knowledge points, 181 to recall and 37 to apply to a case. Measured 2026-11-16 on
two builds of 2026-11-15 and three builds of v3 of 2026-11-16 (`gpt-6-luna`, goal top), judged
by Claude Haiku:

| Build                                  | Cards | Marks held | 95% interval | Points held |
| -------------------------------------- | ----- | ---------- | ------------ | ----------- |
| Slides only                            | 631   | 31.3%      | 23.7 to 37.2 | 56 of 218   |
| With cards from the 18 older papers    | 633   | 43.8%      | 38.0 to 51.1 | 80 of 218   |
| v3, 18 older papers, first build       | 661   | 46.0%      | 37.8 to 55.0 | 84 of 218   |
| v3, 18 older papers, second build      | 668   | 51.2%      | 45.5 to 57.2 | 94 of 218   |
| v3, 18 older papers, third build       | 663   | 48.5%      | 41.9 to 55.9 | 93 of 218   |

- **The measure sees a known gain.** The paired difference is 12.5 points of coverage (6.8 to
  21.7): 35 points gained, 11 lost. The lost ones are facts the slides state that one build
  wrote a card for and the other did not.
- **Two ceilings.** A deck that held every recall point would hold 83.8% of the marks: the
  rest is application to a case, which no card holds. A deck that held every recall point the
  slides state would hold 39.8%. Cards from older papers are what lifts a build above that.
- **Where the misses are.** Of the 138 points the better build misses, 120 have a card on the
  concept that lacks the fact, and 18 have nothing.
- **v3 holds about half the marks.** Its three builds average 48.6% (sd 2.6). Against the 43.8%
  of the build of 2026-11-15 that is 4.8 points, less than three builds against one can show
  (about 6).
- **Builds of the same code differ, and the interval does not know it.** The interval of a
  build, and of a paired difference, covers which questions an exam asks, not the luck of the
  build. Of the 218 points, 63 are held by all three builds of v3, 51 by one or two, 104 by
  none; counting a point that any of the three holds gives 59.0%. So a change of code counts
  only when it beats the old figure by more than this spread allows: with an sd of 2.6, **about
  6 points with three builds a side, 4 with five**. Two a side show only a change above 11, and
  one build against one shows nothing: two builds of one code that happened to land at 48.5%
  and 47.7% made a third at 55.2% look better until the gate asked for Student's t and never
  believed a spread under 2.6. The gain of exam cards over slides only (12.5 points) is large
  enough to stand.
- **The gate on real builds.** Slides only against v3: 17.4 points up, and stopped by two
  guards (664 cards against 631, 36 percent more tokens written). Cards from past exams buy
  their marks with a bigger deck and more writing, which was Steffen's call
  ([RFD 8](0008-past-exams.md)). The build of 2026-11-15 with exam cards against v3: 4.9 points
  up where 12.9 are believable from one build against three, every guard holds, so unclear.
  These builds read 18 papers, the dev papers among them, so they count on the test set only.
- **The dev baseline.** Three builds of v3 at commit `aaaf741`, after the 46 pull requests
  merged on 2026-11-16 (`gpt-6-luna`, goal top, the 14 papers before 2022, judged on the dev
  rubric, 2026-11-17: 672, 666 and 662 cards, mean 667, 0.33, 0.32 and 0.32 dollars), hold
  53.8%, 46.0% and 53.1% of the marks of the dev papers: mean 51.0. They are the old side of a
  gate from now on, in place of the three builds before those merges (671, 653 and 673 cards,
  1.08 dollars together: 48.5%, 47.7% and 55.2%, mean 50.5, sd 4.1). Of the 221 points of those
  earlier builds, 71 are held by all three, 55 by one or two, 95 by none. With this spread a
  change shows from about 9 points with three builds a side and from 6 with five. The earlier
  builds took 876 to 937 calls and 265,000 to 276,000 tokens written. The run folders are
  `bench/runs/entrepreneurship-v3tip-2026-11-17-run1` to `run3` under `eval-results`. The test
  rubric was not read for any of these builds, and the test score of the dev baseline has not
  been read ([#270](https://github.com/stegra05/lectern/issues/270)).
- **The gate on the merges of 2026-11-16.** v3 before them against v3 after them: 50.5 to
  51.0, a difference of +0.5 where 9.5 is believable. Every guard holds: cards 666 to 667,
  words an answer 10.2 to 10.1, calls 911 to 902, tokens written 270,753 to 270,301. The
  verdict is unclear: the merges made the deck neither better nor worse on the dev papers.
- **The gate on #256.** v3 against v3 with #256 (reply cards carry their job number): 51.0 to
  49.4 (45.2%, 51.2% and 51.9%), a difference of -1.5 where 9.1 is believable. Every guard
  holds: cards 667 to 659, words an answer 10.1 to 9.8, calls 902 to 893, tokens written
  270,301 to 263,764. The verdict is unclear. #256 was merged on it as a correctness fix that
  claims no gain: a fix that claims no better cards was merged on "unclear, every guard holds".
- **A run's score counts its own pairs only.** Its shortlist, and what its own judges found
  by searching the deck. Verdicts are kept under the texts of a pair, and builds share some
  cards word for word, so counting every kept verdict let a run rise when others were judged
  after it: the slides-only build read 33.1% instead of 31.3%, and the second and third build
  of v3 first read 53.1% and 49.0%. That drift also made two of the three pairs of v3 builds
  look different beyond their interval; scored on their own pairs, none does. The price: a
  card that holds a point and is outside the shortlist is missed, about 2 points of a deck.
- **The judge is steadier than the build.** Two judges on the same 240 pairs agree on 93%
  (kappa 0.88) and on 29 of 30 points. A rubric whose points bundled several facts scored the
  same deck at 35.2% and let the judges part on 2 of 27 points, so a point is one fact. A judge
  mistypes a card id about once in a deck; the intake refuses the file and the id is corrected
  by hand.
- **What is model-made.** The papers have no official solutions. One Claude Sonnet reading per
  paper wrote the points, a second independent reading of one paper agreed on all five multiple
  choice answers and on the substance of the open questions, and the marks inside an open
  question are an allocation, not the examiner's. Steffen has not yet checked the rubric
  ([#264](https://github.com/stegra05/lectern/issues/264)).
- **What a judging costs.** About 140,000 Haiku tokens per batch of 30 points, 850,000 for a
  whole deck.

## What the reference deck says

**Form is fine.** No hard-limit violation in any full run. Questions average about 10 words,
answers about 10.5 (reference 11.6).

**Coverage is the gap.** Of the 636 notes, after the concept preset (strict judge):

| Where the note stands            | Notes     |
| -------------------------------- | --------- |
| Same fact on a card              | 192 (30%) |
| Missed, the slide text states it | 137 (22%) |
| Missed, only in a picture        | 101 (16%) |
| Missed, not on the slides at all | 206 (32%) |

With past exam questions as cards, coverage rose to 246 notes (39%), and a card answers 34 of
the 52 questions of four papers the engine never saw ([RFD 8](0008-past-exams.md)). About a
third of the reference comes from cases, videos and readings, not slides. Notes
asked 9 or more times in past exams were covered best (38 percent), notes asked once or never
worst (27).

**Runs of the same code differ, and a change has to beat that.** Three runs of v3 on the same
slides, past papers and goal (`gpt-6-luna`, goal top, 661 to 668 cards, 35 to 43 cents each),
each judged once by Sonnet judges in batches of 40, measured with `refdeck.ts spread`:

| Same fact on a card         | Runs          | Mean      | Spread (sd) |
| --------------------------- | ------------- | --------- | ----------- |
| All 636 notes               | 259, 262, 243 | 255 (40%) | 10          |
| Notes asked 9 or more times | 90, 102, 87   | 93 (42%)  | 8           |

- The total moves by up to 19 notes, but far more notes change hands: any two runs disagree on
  88 to 107 notes, which cancel out in the total.
- Most subdecks move by 5 notes or fewer. Business model and plan swings from 20 to 32.
  The map is where runs part: one run read lecture 1 as 87 concepts, another as 23.
- The spread includes the judge's own noise. Judging one deck three times gave 245, 246 and
  249, so most of it is the engine.

A change to the engine counts only when its total beats the old one by **about 29 notes (4.5
points) for one run each, 20 for two runs each, 17 for three** (twice the standard error of
the difference). Three runs give a rough sd, so treat these thresholds as rough too. Smaller
gains need several runs per variant, or a paired comparison on the notes both runs judged.

**Steffen's own verdicts** on 62 cards: 41 keep, 9 right fact but bad card, 5 not worth a card,
7 junk.

## The blind sample

`blind.ts draw` takes the eval folder of a run (its `cards.json`, the exported `reference.json`
and the judged `labels/`) and writes the sample for Steffen and a key kept apart. `blind.ts score`
reads his filled sample and the key.

- **60 pairs by default**, fewer when fewer concepts are matched in both decks; the command says
  how many it drew. At 60 pairs a share near one half is known to about plus or minus 13 points
  at 95%, and 60 pairs is about half an hour of judging.
- **Concepts are drawn from those both decks have.** A concept counts when the judge matched a
  reference note to a card of the run with `same` or `partial`. Lectures are taken in random
  order and one concept from each in turn until the sample is full; a lecture that runs out is
  skipped. Concepts are not weighted by how often past exams asked them: this comparison asks
  whether a card reads as well as the reference card, and what the deck covers is measured by the
  exam marks above.
- **A pair is a reference note and the card the judge matched it to**, so both test the same
  fact as far as the judge's `same` or `partial` holds. When a concept has several such pairs,
  one is drawn at random. Which side is A or B is random per pair. One seed makes a draw
  repeatable, and it is written into the key.
- **Only what both decks have is shown**: front and back, or the gap sentence with its hidden
  words. Note types, tags, ids, source lines and slide marks never reach the sample.
- **Two answers per pair**, typed into the sample file: which card is Lectern's (A, B or ? for
  cannot tell) and which he prefers (A, B or = for no preference). The score is the share told
  apart (right guesses among the pairs answered, a ? counting as not told apart), the share where
  Lectern's card is preferred, and the share with no preference.

## Test courses

Entrepreneurship is the reference, and the only course with a rubric so far. Grundlagen
Datenbanken and Operations Research test the formula and programming presets
([RFD 7](0007-presets.md)), and both have past papers on disk, as does Grundlagen Rechnernetze
with official solutions. Datenbanken has a deck from AnkiTUM as a reference, judged weak: about
140 cards, not atomic, for 9 of 21 chapters.

## Open

- The blind comparison: [#137](https://github.com/stegra05/lectern/issues/137).
- Coverage at the fact level: [#108](https://github.com/stegra05/lectern/issues/108).
- Facts only in pictures: [#106](https://github.com/stegra05/lectern/issues/106).
- The exam rubric checked by Steffen: [#264](https://github.com/stegra05/lectern/issues/264).
- The dev baseline read on the test papers: [#270](https://github.com/stegra05/lectern/issues/270).
