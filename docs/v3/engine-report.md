# Lectern v3 engine: report

Updated 2026-11-14 after the first real runs. Goal: `engine-goal.md`. Decisions:
`engine-decisions.md`. Plan with both milestones: `engine-plan.md`. Branch `v3`, local commits
only, nothing pushed. Milestone 1 ends at `15d00fc`, milestone 2 is `f5d004a`, the commands for
the interface and the fixes from the real runs follow it (up to `3d408f8`).

## Verdict

The engine works end to end on real slides with a real cheap model: the 11 Entrepreneurship
decks became 596 cards for 17 cents in 17 minutes, with no card over a hard limit. The method
in code holds. The content does not yet: the placeholder preset and the uncalibrated slide
labels let course administration, exercise instructions and thin cards through. That is the
work of the real presets and of calibration, not of the pipeline.

## Commands

| What | Command |
|---|---|
| Tests | `pnpm --filter @lectern/engine test` |
| Typecheck | `pnpm --filter @lectern/engine typecheck` |
| Lint | `pnpm exec eslint packages/engine` |
| Estimate, free | `node packages/engine/src/cli.ts estimate <course folder> [--goal pass\|good\|top] [--model gpt-6-luna]` |
| Build, paid | `node packages/engine/src/cli.ts build <course folder> [--goal ...] [--profile ...] [--model ...] [--cap dollars]` |
| Outline | `node packages/engine/src/cli.ts outline <course folder>` |
| Send to Anki | `node packages/engine/src/cli.ts send <course folder> [--design native]` |

PDFs go into `<course folder>/slides/`. A build needs `OPENAI_API_KEY`.

## Test results

| Run | Result |
|---|---|
| Engine tests | 223 passed, 2 skipped (the live OpenAI tests, which need `LECTERN_LIVE=1`), 9 files |
| Live OpenAI tests, run once with a key | 2 passed |
| Typecheck, lint, format | clean |
| Root `pnpm test` (the v2 suite) | 406 passed, 12 skipped, unchanged |

By file: validators 57, cards 20, tree and lecture numbering 14, plan, clashes and estimate 11,
whole pipeline 42, library commands and the offline models 14. The pipeline test uses real PDFs, the real pdf.js reader and renderer and
real files; only the two models are scripted.

## First real runs

All on `gpt-6-luna` for writing and for decisions, goal top grade, 2026-11-14.

| Run | Engine | Cards | Dropped | Flagged | Cost | Estimate | Time |
|---|---|---|---|---|---|---|---|
| One deck, 16 slides | before the cache fix | 47 | 0 | 6 | 1.8 cents | 0.7 cents | 71 s |
| The same deck | with the cache fix | 40 | 0 | 7 | 0.7 cents | 1.3 cents | 49 s |
| 11 decks, run by the app session | before the cache fix (`7332526`) | 658 | 7 | 38 | 48.4 cents | 18.6 cents | 19.4 min |
| 11 decks, run by this session | with the cache fix (`a460b25`) | 596 | 5 | 31 | 16.7 cents | 33.6 cents | 16.6 min |
| 11 decks with the concept draft | `704922e`, preset `concept-draft` | 554 | 8 | 24 | 18.6 cents | 25.0 cents | 17.5 min |

The two full runs happened at once by a coordination miss between the two sessions: each had
Steffen's yes, and the messages crossed. Total spent on OpenAI on 2026-11-14, all sessions together:
about 1.10 dollars of the 50 (this session about 90 cents, the quality session about 18 cents
for grading 1,150 cards and for measuring its checks). On 2026-11-15: 1.5 cents more. Both results are kept. The reference deck has 636 notes for the same decks.

My full run in numbers (course folder under the shared notes folder, `courses/entrepreneurship`):

- 356 slides, 268 concepts, 642 facts, 596 cards. 23 slides left out: 16 without a testable
  fact, 5 title, 1 agenda, 1 recap.
- Card types: definition 175, cloze-list 137, contrast 109, reverse 76, case 70, diagram 15,
  chain 12, code 1, formula 1. 151 cards with a typed answer.
- Hard limits, measured on the stored fields: 0 violations in 596 cards. Questions average
  10.3 words. Answers average 10.5 words (the reference deck: 11.6).
- Dropped, each listed with its reason: 3 asked a question the course already had, 1 had a slot
  label over 4 words, 1 had a list item over 8 words.
- Flags: 25 cards copy a long run of slide text, 5 may test the same thing as another card,
  1 answer may not be on its slide, 35 concepts may not belong to their lecture.
- 672 model calls, 1,327 decisions, 3.68 million input tokens of which 83 percent came from the
  cache, 124,000 output tokens. Phases: read 9 s, map 541 s, write 397 s, check 51 s.

Between the two full runs the map differs: 268 against 295 concepts, 596 against 658 cards,
per lecture within about 20 percent. The same slides do not give the same deck twice.

**What the real runs taught, and what I changed**

- Both adapters worked against the API on the first call.
- The prompt cache did not work at first, so every card call paid full price for the whole
  lecture and the run cost 2.6 times its estimate. OpenAI reuses a prompt prefix only up to an
  explicit breakpoint, and only between calls with the same reply form and reasoning effort
  (measured with five small calls). Fixed: the adapters set the breakpoint, the first card of
  each type in a lecture goes ahead to fill the cache, and the run file records cached input.
  The same deck then cost 60 percent less.
- The estimate was recalibrated on the first deck. It now errs high: 33.6 cents estimated,
  16.7 real.
- A build takes a spending limit (`capUsd`, `--cap`). My run used the 56 cents I had named.
- The check phase could report more cards done than in total after a split. Fixed.

**What the cards look like**

Read as a student would, a sample of the output is mixed.

- Good: the cards are short, one fact each, in the roles the plan chose. Contrasts have two
  labelled sides, lists hide one item per card, typed answers appear only on short terms.
- Course administration gets cards. "Course instructor", "Course opening" and "Course outline"
  are concepts in several lectures, there is a card asking where the lecturer is professor, and
  the seating instructions of a class exercise became a `code` card. Only 2 of 356 slides were
  labelled agenda or recap, so the slide labels let these through; uncalibrated, a label would
  not have removed them anyway.
- Thin cards: "Last session: what aspect of entrepreneurial intentions was covered?", or a
  contrast whose second side reads "No specific reasoning pattern is stated".
- Some definitions are full sentences that restate the question, where the reference deck
  leads with the term.
- The flags look useful. All five "may test the same thing" pairs I read are real duplicates.
  The 35 "may not belong" flags point mostly at exactly the administration concepts. That is
  a first sign that these two checks are worth calibrating.
- Diagram cards misuse the three types: a figure with three inputs and one result came back
  as a "sequence", twice, differing only in the marked cell.
- Recurring concepts work mechanically, and so the administration concepts recur too and get
  one more card in each lecture.

## Checks added after the first runs

Built by the session "Card quality and relevancy patterns" on Steffen's instruction (commit
`ba081d2`), measured on the cards of the two full runs and on 62 cards he judged himself. This
is its account, not re-measured by me:

- **Organisation.** A decision check on each card that passes the limits: is it about the
  organisation of the course. It is calibrated (threshold 0.2) and drops such a card, since no
  rewording repairs it. On the placeholder run it names 30 of 596 cards, 27 of them
  administration; on the concept draft run 2 of 554, because the draft's map rules had already
  removed them.
- **Says nothing.** A rule in code: the answer stands in the question, a sentence only turns
  the question around, or a side of a contrast repeats its label. Such a card goes back for
  repair.
- **Leans on the slides.** A word rule for questions that only make sense with the slides at
  hand. A decision check for the same thing was measured against it and lost.
- **A finding about the decision model.** Asked about one card while a whole lecture was the
  input, it said yes to nearly everything. So the card checks give it the card alone.

**My two checks, re-measured on 2026-11-15** (approved by Steffen, 1.5 cents, on the concept
draft run). Positives and negatives were built, not hand-labelled: a card with the slide it was
written from against the same card with a far-away slide of the same lecture, and a concept of
a lecture against a concept only another lecture has. These are easy negatives, so the numbers
show whether a check can tell at all, not how it does on subtle cases.

| Check | Input | Yes to the right case | Yes to the wrong case | Right at 0.5 |
|---|---|---|---|---|
| Slide supports the card | the whole lecture | 65 of 66 | 50 of 66 | 61% |
| Slide supports the card | the slide alone | 65 of 66 | 12 of 66 | 90% |
| Concept belongs to the lecture | the whole lecture | 54 of 55 | 5 of 55 | 95% |
| Concept belongs to the lecture | the concept's slides alone | 54 of 55 | 0 of 55 | 99% |

The slide check was close to useless as built: with the whole lecture as input it accepted
three of four wrong slides. It now gets the slide alone, one request per slide, and goes from
61 to 90 percent on this set (96 percent at a threshold of 0.65). The concept check already
worked with the lecture as input and stays as it is. Both remain uncalibrated: they flag and
never drop until a threshold is set on labelled data. The raw answers are in the shared notes
folder, `courses/check-measurement-2026-11-15.json`.

The cost estimate now counts one small decision request per card for the organisation check.

**One real lecture with the new gate** (lecture 8 of Entrepreneurship, concept preset, goal top
grade, 2.1 cents, 114 seconds): 69 cards, none dropped, 5 repair calls on 69 fills, 202
decisions. Definitions now mark what answers the question ("Using any possible method to
==conserve cash==") where the earlier run marked the term asked about ("==Bootstrap financing==
means ..."). Two gaps showed in its cards. "Which two main subjects does Session 6 cover?"
passes the word rule, which looks for "the session" and "last session" and not for a session
number. And a contrast side such as "Opportunity: Opportunity: they invest because ..." passes
the "says nothing" rule, because it adds words after repeating its label. One lecture is a
small sample: no full run has been made with the gate.

## Measured against the reference deck

By the session "Card quality and relevancy patterns", 2026-11-14. Both full runs (placeholder,
596 cards, and concept draft, 554 cards) were compared with the 636 notes of the reference
deck. A small model (Claude Haiku) judged, in two passes: for every reference note, whether
the generated deck has a card on the same fact, only the same concept, or nothing; and for
every generated card, one label. I checked about forty of its calls by hand. It is not a blind
comparison by a person, and its "sound" label is lenient.

| | Placeholder run | Concept draft run |
|---|---|---|
| Cards labelled sound | 63% | 77% |
| About course organisation or the session itself | 17% | 4% |
| Broken: the answer does not answer the question | 9% | 10% |
| Thin or trivia | 11% | 9% |
| Reference notes with a card on the same fact | 39% | 36% |
| Reference notes with the concept, without the fact | 54% | 58% |
| Reference notes with no counterpart | 7% | 5% |
| Generated cards with no counterpart in the reference deck | 46% | 39% |

- **The concept preset fixed administration and did not move coverage.** The three points
  between 39 and 36 percent are within what the judge varies by.
- **The misses are facts, not concepts.** The map finds the concept almost every time. The card
  then tests another fact of it than the one the exam asks. `plan.ts` takes the first facts of
  a concept in the order the model listed them; nothing ranks them.
- **No sense of what matters.** Coverage is the same for notes asked once (36%) and notes asked
  nine times or more (43%).
- **The reference deck is selected by the exam, not by the lectures.** Every note carries how
  often 22 past papers asked it. 132 of the 636 notes cite no slides at all (videos, the Krapp
  and HIGGS cases, Greiner, Teece, past papers) and are covered at 2 percent. Greiner's crises,
  Porter and the names of the effectual principles are not in the slide text. On the 504 notes
  that cite slides, coverage is 48 and 45 percent. A deck from slides alone cannot reach this
  reference, so coverage should be reported on that part.
- **Card types.** Weakest by label: diagram (33 to 40 percent sound), case (30 to 58), contrast
  (65 to 75). Reverse, why and list cards reach 79 to 88 percent on the draft run.
- **The flags of the first runs did not find the defects.** In the draft run 21 of the 24
  flagged cards were sound, and 2 of the 23 cards about organisation or the session sat on a
  flagged concept.

**The decision model as a grader** (all 1,150 cards, five questions per card, 32 seconds, 10.8
cents). Against the labels above: organisation 0.88, slide-meta 0.92 and a four-level rubric
"worth studying" 0.87 (area under the curve; 0.5 is chance). "The answer answers the question"
is weak (0.67, and 86 percent of all cards score above 0.9). "An exam could ask this" is
useless: every card scores above 0.9. The rubric follows the reference deck only loosely: cards
with a counterpart there against cards without, 0.70; notes asked nine times or more against
notes asked twice or less, 0.58. So it can order cards, and it cannot tell what is examined.
It is not in the engine: nothing uses a score yet.

**Steffen's own verdicts.** He judged 62 cards in two rounds (41 keep, 9 right fact but bad
card, 5 not worth a card, 7 junk) and then said he does not know the course contents yet. So
they count for form (cards about the session, answers that do not answer, malformed contrasts)
and not for what is worth studying. A student who has not learned the course is in the same
place: a feedback loop should not ask them whether a card is relevant.

**Not in the repository.** The scripts, the judge's labels and the decision model's raw answers
were in that session's scratch folder. The figures here are what is kept.

## Where the missed facts are

By the session "What's next", 2026-11-15, with the harness that is now in the repository
(`packages/engine/eval/refdeck.ts`, judge rules in `eval/JUDGE.md`). The concept draft run (554
cards) was judged again against all 636 reference notes by Claude Haiku, 16 batches of 40. The
judge was told to be strict, and for every miss it also said where the fact is. I checked a
sample of its labels against the slide text: the "same" and "text" labels hold, the line
between "picture" and "absent" is soft.

| Reference notes | Count | Share |
|---|---|---|
| A card tests the same fact | 192 | 30% |
| Missed, and the slide text states the fact | 137 | 22% |
| Missed, a slide shows it in a picture and its text does not say it | 101 | 16% |
| Missed, not on the slides at all | 206 | 32% |

The 30 percent is the 36 percent of the earlier measurement under a stricter judge (192 against
230 notes), not a change in the cards.

- **The plan is not the cause.** At goal top the plan keeps 561 of the 633 facts the map found.
  Ranking facts before the plan picks them cannot lift coverage at this goal: the examined fact
  was never in the map. 81 of 232 concepts have one fact. A ranking matters for the goals pass
  and good, which keep 180 and 372 cards.
- **The model never saw the figures.** A slide with under 100 characters of text goes to the
  model as a picture. Every slide of these decks carries a footer of about 100 characters
  (lecturer, course, session, page, date), so only 6 of 356 slides were shown. The Greiner
  slide is a title and a figure: 35 reference notes hang on it and the deck has one card. The
  table of entrepreneurial against traditional management (12 notes), Kickstarter (10), the
  business model canvas (11) and the IOOI framework (3) are the same case. Fixed in code
  (`slides.ts`): lines that at least half the slides of a deck repeat, compared without
  digits, are removed before anything else reads the text. 99 slides now go out as pictures,
  and the lecture text every call reads is 23 percent shorter. The estimate for the full run
  rises from 25 to 51 cents. What it did to coverage is in the next section. On Grundlagen
  Datenbanken the rule moves 249 to 284 of 708 slides.
- **What slides alone can reach.** 52 percent of the reference notes are in the slide text, 68
  percent with the pictures. The run has 58 percent of what the text states. The last third
  needs the cases, the videos, the papers and the past exams.
- **Coverage still does not follow the exam.** Asked 0 to 1 times: 27 percent. 2 to 4: 27.
  5 to 8: 25. 9 or more: 38.
- **By subdeck**, weakest first: Organizing and teams 14 percent (Greiner), Business model and
  plan 19, Impact and corporate entrepreneurship 21, Ideas and opportunities 22, Digital
  entrepreneurship and Teece 23.

The exports, batches and labels are in `eval-results/v3-eval/concept-draft/` (not in git). The
scripts and labels of the 2026-11-14 measurement are kept beside them in
`2026-11-14-quality-session/`.

**The second course.** Grundlagen Datenbanken is set up as a course of 9 chapters (708 slides)
in `eval-results/v3-courses/grundlagen-datenbanken`. Estimate at goal top: 1,358 cards, 1.78
dollars. Its deck in AnkiTUM is about 140 cards by another student, several facts per card, for
9 of 21 chapters: a weak reference. The 8 past exams would be a better one.

## Three steps on coverage

Same session, 2026-11-15, on Steffen's go ("You may do all of what you suggest. Deck should
stay near my size"). Three changes, each run in full on the 11 Entrepreneurship decks
(`gpt-6-luna`, goal top grade, concept preset) and judged the same way: 16 Haiku judges, all
636 reference notes, strict.

1. **The footer rule** (previous section): 99 slides go to the model as pictures instead of 6.
2. **A second reading.** After the map, the model reads the lecture once more with its own map
   and returns the facts the map lacks (`askMore`, `withMore`).
3. **The worth of a fact and a goal in cards.** The decision model scores each fact alone on
   four levels (not examinable, detail, examinable, core). The goal is a number of cards per
   slide (pass 0.5, good 1, top grade 1.8, which is the reference deck: 636 notes on 356
   slides), and the facts worth most get them. The `core` flag of a concept and the rule "the
   first N facts of each concept" are gone.

| Run | Facts in the map | Cards | Cost | Reference notes with a card on the same fact |
|---|---|---|---|---|
| Concept draft, 2026-11-14 | 633 | 554 | 18.6 cents | 192 (30%) |
| 1: footer rule | 670 | 588 | 31.0 cents | 206 (32%) |
| 1 to 3, cards shared out per lecture | 849 | 573 | 36.9 cents | 214 (34%) |
| The same facts, cards shared out over the course (counted, not run) | 849 | 641 | | 234 (37%) |
| The same facts, nothing cut (counted, not run) | 849 | 849 | | 253 (40%) |

The two last rows come from one more judge pass: the 422 notes the third run missed, against
the 265 facts its plan had cut. 39 of them were there.

- **Why the score.** Before building it I tested it on the concept draft run: 633 facts scored
  alone (1.4 cents), joined to the cards and their judged matches. At 372 cards the facts with
  the highest score keep 164 of the 192 covered notes, the first 372 in the order of the map
  keep 133, and 372 at random 129. The order in which the model lists facts carries no
  information about what the exam asks. The score does: a kept fact matched a reference note
  2.3 times as often as a cut one (37 against 16 percent).
- **The figures are read now, and it shows in the cards.** Greiner had one card; it now has the
  five phases, the crises in order and which crisis ends which phase. "Organizing and teams"
  went from 14 to 25 percent, "Impact and corporate entrepreneurship" from 21 to 47.
- **The budget per lecture was a mistake of mine, found by the measurement.** Cards per slide,
  counted lecture by lecture, gave lecture 4 (96 slides, many of them steps of one animation)
  173 cards for 140 facts and lecture 9 (24 slides, Greiner) 44 cards for 107 facts. The deck
  came out at 573 cards, below the size asked for, and the cuts fell where the reference deck
  is densest. The plan now shares the cards out over all lectures of a build (`plan.ts`). On
  the judged facts that is 234 notes at 641 cards. It has not been run.
- **Coverage follows the exam a little more.** Notes asked 9 times or more: 38, 38, 42 percent.
  Asked once or never: 27, 30, 27.
- **How much to trust two points.** Between the concept draft and the third run, 80 notes were
  gained and 58 lost. The map differs from run to run and the judge is not perfectly steady, so
  one run against another is good to about three points. The three steps point the same way;
  none of them is proven alone. The comparison at equal facts (the two counted rows) does not
  have this noise.
- **Cost and time.** The third run cost 36.9 cents against an estimate of 55, and took 41
  minutes while another run shared the account: the pictures make every call larger, and 849
  facts each get a request for their worth. Spent on 2026-11-15 by this session: 69 cents on
  Entrepreneurship, plus the Grundlagen Datenbanken run below.

**What is still missing, on the third run** (422 notes): 217 are not on the slides, 65 are only
in a picture, 140 are stated in the slide text. Of those 140, 38 were in a fact the plan cut
and 102 are in no fact at all. Read through, many of the 102 are the plain definition of a
concept that has cards from other angles ("What is corporate entrepreneurship?", "Teece: what
are complementary assets?"), or one more item of a list the map took in part.

**Next, in order of what the numbers say:**

1. Extraction is still the larger gap inside the slides: 40 percent of the notes are in the
   map's facts, 56 percent are in the slide text, 68 with the pictures. Candidates: a rule in
   code that every concept carries a fact saying what it is, and a map per section of a lecture
   instead of one call for all of it.
2. A third of the reference deck is not on the slides. Only other material reaches it: the
   cases, the videos, the past exams.
3. Two or three runs per variant, or judging at the level of facts, before a difference of two
   points is believed.

## What was built

`packages/engine`: 3,800 lines of source, 2,717 lines of tests, no interface code, no build step.

**Milestone 1** (unchanged in substance): the package and its one boundary (commands in, events
out, plain JSON), the course folder, validators for the hard limits, typed answers, stable ids,
the scripted model, incremental builds, the outline export.

**Milestone 2**, by criterion:

| # | Criterion | Where |
|---|---|---|
| 1 | Cards in `lectures/NN/cards.yaml`, dropped cards listed, earlier files byte-identical | `course.ts`, tested in `pipeline.test.ts` |
| 2 | One decisions port, batched per shared input, OpenAI adapter, scripted fake | `ports.ts`, `decide.ts`, `adapters/openai.ts`, `adapters/fake.ts` |
| 3 | Calibration per check: unmeasured flags, measured acts, both tested | `decide.ts`, `build.ts`, "calibrated checks act instead of flagging" |
| 4 | The seven steps end to end with a placeholder preset | `build.ts`, `mapper.ts`, `writer.ts`, `presets.ts` |
| 5 | The plan as a pure function | `plan.ts`, `plan.test.ts` |
| 6 | OpenAI model adapter with a gated live test | `adapters/openai.ts`, `openai.live.test.ts` |
| 7 | `estimate` command, estimate before the first paid call, cap that stops | `cost.ts`, `ask.ts`, tested with a model that charges |
| 8 | All twelve roles validate, `code` and `diagram` with their own checks | `cards/roles.ts`, `cards/validate.ts` |
| 9 | Tests, typecheck, lint with one command each | see above |
| 10 | First real run only after a yes | done after Steffen's yes, see "First real runs" |

How the seven steps run:

1. **Profile.** One closed question per course picks the kind of lecture. It is emitted as a
   `profile` event for the student's one line and stored in `course.json`. A command can
   override it.
2. **Kind of slide.** One question per slide, the whole lecture as shared input. The label is
   the reason shown when a slide has no cards.
3. **Map.** One model call per lecture returns topics, concepts and facts with their slide.
   Code checks it and asks once more with the problems. Two closed checks follow.
4. **Kind of fact, then the plan.** Each fact gets a kind from the closed list. Code plans the
   cards: pass is one fact of each core concept, good grade two facts of every concept, top
   grade four plus every case and contrast. The kind and the preset pick the card type.
5. **Fill.** One call per planned card. The model sees the whole lecture and fills one small
   form for that card type, with the limits written into the fields and an example from the
   preset. Reasoning effort is low.
6. **Gate.** Hard limits, the copy check, the slide check. A card that is too long is split
   into up to three atomic cards. Other failures are repaired with the full list, twice at
   most. What still fails is dropped and listed with concept and reasons.
7. **End.** Code pairs cards that look alike across the course and the decision model judges
   them. An identical question is dropped by code. Nothing is rewritten.

**For the interface**, added after milestone 2 at the app session's request:

- Commands `courses` (the library), `course` (one course: lectures with topics, concepts and
  card counts, left-out slides, dropped cards, PDFs waiting to be built, decisions, runs),
  `cards` (the cards of a lecture), `slide` (one slide as a PNG), `create` (a course with a
  name) and `add` (PDFs as file name plus base64, so the boundary stays plain JSON). Shapes:
  `src/library.ts`, events in `src/api.ts`.
- `adapters/offline.ts`: a model and a decision model that need no script and no network. They
  turn the text of any slides into a small course, so an interface test can run a real build.
  They say nothing about real card quality.
- The adapters are exported from the package (`@lectern/engine/adapters/...`).

## Sending to Anki

Added 2026-11-14 by a third session, on Steffen's instruction, and run against his real Anki
the same evening with his yes (Anki 26.9.4 with the AnkiConnect add-on).

**What it does.** The command `send` takes a course and a card design. It installs Lectern's two
note types in that design, creates one deck per lecture under the course's deck
(`Entrepreneurship::02 Effectuation`, the number first so Anki lists them in course order),
stores the slide picture of every card, and adds one note per card. Events: `sending` after
each card, `sent` at the end with the course's deck. The command `restyle` gives the cards
already in Anki another design. `course` now reports `sent` per lecture.

**A card is sent once.** `<course>/anki.json` records the course's deck and the Anki note of
every card that went. A later send adds only cards that are not in it. A note in Anki is never
written again: not its wording, not its progress, and a note the student deleted does not come
back. The record is saved even when a send breaks off, so the next send continues with the rest.

**Where it is.** `src/deliver.ts`, the ports `anki` and `designs` in `src/ports.ts`,
`adapters/ankiconnect.ts` (the add-on on `127.0.0.1:8765`), `adapters/memory-anki.ts` (an Anki
in memory that behaves like the real one where it matters, for tests and for the app offline),
`adapters/node-designs.ts` (reads `design/v3/cards/anki`). Tests: `test/deliver.test.ts`, 19.

**The real run.** Two lectures of the first real Entrepreneurship run (03 and 09, 94 cards),
copied into a course named "Lectern send test", from the command line.

| Figure | Value |
|---|---|
| Cards sent | 94, into 2 subdecks, with the fields, tags and note types as planned |
| Time | 10.9 s, slide pictures included. About 75 s for a course of 650 cards at that rate |
| Slide pictures | 38 PNG, 4.9 MB, 130 KB on average, 540 KB the largest. About 45 MB for 350 slides at that rate |
| Notes that Anki did not keep | 2 of 94 |
| A second send | "Every card of this course is already in Anki." |
| Design change to Lamp and back | Both note types changed, the Lectern 2 note types did not |
| His reference deck | 636 notes before and after |

What the real Anki taught, and what changed because of it:

- **Anki can hand back a note and not keep it.** Two notes got an id and were not in the
  collection afterwards. Steffen confirmed the cause: he was studying in Anki and pressed undo.
  The add-on records every added note as an undo step, so the undo took Lectern's newest note
  instead of his answer. A student who studies while Lectern sends will do the same. Now the
  send asks Anki which notes of a lecture are there, adds the missing ones again, up to three
  times, checks the whole send once more at the end, and fails with the count when some still
  do not stay. Only notes found in Anki are recorded.
- **A course named like a deck the student has.** His own deck is called "Entrepreneurship",
  with subdecks. A course of that name would have put Lectern's cards into it. The first send
  now takes a deck that is not there yet ("Entrepreneurship (Lectern)") and keeps it.
- **Anki writes media under lowercase names.** `_LampSerif.woff2` became `_lampserif.woff2`,
  which a Mac still finds and a phone does not. Fonts and pictures are now stored and named in
  lowercase.
- **`Lectern Cloze` was taken**, as expected: his collection has the Lectern 2 note types.

**Defaults I chose, none of them in the design documents:**

| Topic | Default | Why |
|---|---|---|
| Cloze note type name | `Lectern Cloze v3` | Lectern 2 installed `Lectern Cloze` with other fields. `FIELDS.md` is updated |
| Tags | `<course>::lecture::02` and `<course>::role::definition` | Hierarchical, as in his study kits. Exam part and weight wait for past exams |
| Slide pictures | `lectern-<course>-l02-s14.png`, PNG, 1024 px wide | Anki keeps all media in one folder, so the bare `l02-s14.png` of two courses would collide |
| Deck preset | Not touched | The study plan brings the preset. Until then the new decks use Anki's default |
| Who owns a note type | Lectern, while its stylesheet opens with the `lectern-notetype` line | The rule of Lectern 2. A student who edits the styling removes the line |
| Same question twice | Allowed | Anki refuses a note whose first field it has. Two courses may ask the same question |

**Open.**

- Nobody has looked at the cards in Anki itself yet, on the Mac or on a phone. The rendered
  HTML was read back and is what the templates should give.
- The send from inside the app has only run on the Anki in memory. The real run used the
  command line, which shares the engine code and not the app's wiring.
- An undo after the last check of a send still removes its newest note unnoticed. The
  student's own undo is lost too: it takes Lectern's note, not the answer it was meant for.
- `FIELDS.md` wants `Key` as the sort field. The add-on cannot set a sort field when it creates
  a note type, so Anki sorts by the first field.
- Left in his collection by the test, for him to delete: the decks "Lectern send test" (94
  notes) and "Lectern send test (Lectern)" (35 notes), 53 pictures named
  `lectern-lectern-send-test*`, and the two Lamp fonts. The two note types stay.

## Changing single cards

Added 2026-11-14 and 15 by the session that built sending. Tested on the Anki in memory, in
the app end to end, and from a script against Steffen's real Anki (one lecture of 36 cards as
the course "Lectern edit test").

**What it does.** Four commands. `slots` gives a card as a form holds it: the slots of its role
in plain text, with the key term apart from the answer and the hidden parts of a gap sentence
as a list. `edit` takes such slots for a card and keeps its id, slide and place. `remove` takes
a card out of its lecture. `write` adds a card of the student's own to a concept: a question
with a one-sentence answer, or a sentence with gaps. `cards` now also says which cards are in
Anki.

**How.** `src/cards/slots.ts` reads the slots back out of the stored fields, the reverse of
`assemble.ts`, so the card file keeps its shape. All 658 cards of the first real run come back
unchanged from fields to slots to fields. An edit runs through `validateDraft` and `assemble`
like any card. The form's own checks come first and speak to a student ("It has 22 words. The
limit is 20."); what only the validator finds is passed on in its words, which are written for
the model.

**In Anki.** An edited card that is already there changes there too, as the same note with its
progress. A removed one is deleted there. Both need Anki open; when it is closed nothing
changes, here or there. When the student has deleted the note in Anki, an edit makes the card
count as not sent again. An own card is tagged `<course>::own` when it is sent.

**Where it is.** `src/edit.ts`, `src/cards/slots.ts`, two more calls on the `anki` port,
`updateSent` and `removeSent` in `src/deliver.ts`. Tests: `test/edit.test.ts`, 15.

**Against the real Anki, 2026-11-15.** All four worked on the first try. An edited card
changed in Anki as the same note, with its cards and tags untouched. A removed card left Anki
and the record. A card whose note was deleted in Anki counted as not sent after an edit and
went again with the next send. An own card arrived with the tag `lectern-edit-test::own`.
The course ended with 36 cards, 36 of them in Anki.

**Open.**

- Edit and remove from inside the app against a real Anki. The script shares the engine code
  and not the app's wiring.
- A card that passed when it was built can be refused on a later edit, because the validator
  has grown since. The student then cannot save a change to another field of that card.
- An own card takes the first slide of its concept. The student cannot choose the slide.
- The form has no preview of the card in its design.

## Placeholder

`presets.ts` holds **one placeholder preset** used for every kind of lecture. Its plan table is
my guess, its examples are seven of the sample cards from `design/v3/samples.md`, its rules are
five lines. It exists so the pipeline runs. It is not one of the four presets Steffen will
approve, and no result from it should be read as the quality of the method.

The preset for concept courses, `concept`, was written from the Entrepreneurship study kit and
accepted by Steffen on 2026-11-15 as the working preset: every course read as a concept course
is built with it. In its comparison run it removed the course administration from the cards (71
such cards down to none) and brought "why" cards (11%); definitions that restate their question
and near-identical cards remained, and code checks for the first followed. Details and a table
against the reference deck: `engine-profile-concept.md`.

## Where a decision met something already built

| Decision | What I did | Open |
|---|---|---|
| Step 2: slides that are not content are left out | Uncalibrated, the label does not remove a slide from the map. It becomes the reason when the map leaves the slide unused. Calibrated, facts on such slides are refused | Two rules pulled against each other: "left out" and "unmeasured checks only flag". I followed the second |
| Step 1: blends of kinds, weighted | One kind is chosen. No blend | Needs the real presets first |
| Step 5: key terms exactly as on the slides | A rule in the prompt, plus the copy check that flags sentences taking over 8 or more slide words in a row | Not enforced by code |
| Decision 6: a small model where the provider has no decision model | Not built. Only OpenAI's Decisions API sits behind the port | Needed for a provider without one |
| Decisions API: "up to 400 questions per request" | The installed SDK (7.38.0) documents 1 to 200, so the adapter sends chunks of 200 | Harmless either way |
| Decision 10: readable YAML as in the study kits | The file holds the card fields as they go to Anki (HTML, all 16 fields, empty ones too), not the kits' Markdown | Is field HTML readable enough, or should the file hold the slots and the fields be built at delivery? |
| Decision 9: drawings from a small set of types | Three types: matrix, sequence, cycle. Data shape and validator only; the card shows the slide | A canvas such as the BMC does not fit these three |
| Decision 7: stop cleanly at the cap | The run fails with a message and saves nothing. Calls already under way (up to four) still finish. A command can set its own limit | A stopped run loses its paid work |
| Thinking off for recall tasks | Fill, repair and split run on effort `low` | Whether the model accepts less than `low` is unverified |
| Milestone 1: Anthropic adapter | Removed, no backward compatibility | |
| Milestone 1: a rejected card kept its role and went back twice | Still twice, now with the split step first for cards that are too long | |

New in the files, not in `FIELDS.md`: `flags` on a card and on a concept, and `diagram` on a
diagram card. The interface session should know these exist.

## Unverified

- **Quality against the reference deck.** Measured once, by a small model as the judge: see
  "Measured against the reference deck". Still open: a blind comparison by a person who knows
  the course, and any measurement of a full run built with the new gate.
- **Prices.** The cost figures use constants from the v2 config and the decisions file. They
  have not been checked against the OpenAI bill.
- **Decision input.** Cached decision input is priced at the full rate here, as an upper
  bound; the real discount is not published.
- **Slide pictures.** Slides with little text went to the model as pictures in the real runs.
  Whether the model used them well was not examined. The Slide field still names a PNG that
  nothing saves; the `slide` command renders on request.
- **Rate limits** held with four calls in parallel on this account; other accounts may differ.
- **The two extra test courses** are readable (21 and 17 PDFs). Nothing was run on them.
  German yes/no openers and real code cards have never met real slides.

## Proposed next steps

1. Steffen's verdict on the concept draft: use it as the working preset for concept courses,
   or change it first. It and the organisation check remove the same defect from two ends.
2. Calibrate the slide check on hand-labelled cards. It now tells a right slide from a wrong
   one; whether it catches an answer that is only subtly off its slide is unmeasured.
3. Checkpoints: a run saves nothing until the end, and one died on a dropped connection. The
   adapter now retries harder; saving per lecture would end the risk.
4. Still open in code from the comparison run: merging near-identical facts before cards are
   planned, and a cap on lists and contrasts per concept.
5. Coverage, the largest gap the measurement found: the map has the concept and the card
   tests another fact than the exam asks. Candidates are ranking the facts of a concept before
   the plan picks them, and other course material beside the slides. The comparison itself
   should become an engine command, so that each such change is measured the same way.
6. A small run on Datenbanken and Operations Research once code and formula cards have a preset.

## Follow-ups outside my paths

- `pnpm-lock.yaml` is shared. My commit `f5d004a` includes the entries of `packages/app`, which
  another session added but has not committed. `pnpm-workspace.yaml` (the `electron` line) is
  theirs and I left it uncommitted.
- Root `pnpm lint` fails locally on `design/v3/cards-lamp/build-gallery.mjs`.
