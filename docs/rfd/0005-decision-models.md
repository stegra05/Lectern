# RFD 5 · Decision models judge, and only measured checks act

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| **State** | decided                                                           |
| **Date**  | 2026-11-14, checks cut 2026-11-16                                    |
| **Code**  | `packages/engine/src/decide.ts`, `adapters/openai.ts`             |

> **In one breath.** Every yes-or-no question goes to a cheap decision model, but nobody knows
> how accurate it is. A check runs only with a measured threshold, and then it acts.

## Decision

- **Closed questions go to a decision model**: kind of fact, worth of a fact, organisation, and
  the kind of an added file, unless its name already keeps it out (see below).
  OpenAI's `POST /v1/decisions` on `gpt-6-luna` (GA since 2026-10-22; the SDK documents 1 to
  200 questions per request, so the adapter sends 200). Google's `gemini-decision-1` exists
  but has no adapter. Neither returns explanations or publishes accuracy. About 2,000
  decisions for a course cost two to three cents.
- **The input is as small as the question.** A card alone for the organisation check, one fact
  alone for its worth.
- **A check runs only with a measured threshold, and it acts.** A strong model labels a few
  hundred examples from Entrepreneurship, Steffen spot-checks about thirty, and a threshold is
  set. A check that only flags is not run. Today only the organisation check exists: at 0.2 or
  more (`ORGANISATION_THRESHOLD`) the card is dropped without repair, because no rewording fixes
  a fact about course administration.

## Why

Measured on 2026-11-15 (1.5 cents, built positives and negatives):

| Check                  | Whole lecture as input       | Smallest input                  |
| ---------------------- | ---------------------------- | ------------------------------- |
| Slide supports card    | 50 of 66 wrong accepted, 61% | slide alone: 12 of 66, 90%      |
| Concept belongs        | 5 of 55 wrong accepted, 95%  | concept's slides: 0 of 55, 99%  |

With a whole lecture as input, yes/no questions say yes to nearly everything. As a grader
over 1,150 cards (10.8 cents): organisation separates at 0.88, slide meta at 0.92, worth at
0.87. "An exam could ask this" put every card above 0.9 and is useless.

Flags found little: in the concept-preset run, 21 of 24 flagged cards were sound. A flag nobody
can trust is noise, so the flag-only checks were removed.

## The kind of an added file

When a student adds files without saying what they are, a course folder for instance, each PDF
is sorted into one of eight kinds (`sort.ts`): lecture slides, lecture notes, past exam, exam
solution, exercise sheet, exercise solution, reading, course organisation. Only lecture slides
and past exams come in; everything else stays out of the course and is listed in the setup
panel, where the student can add a file by hand.

- **A name can keep a file out, never let it in.** File and folder names that say exercise,
  solution, notes, reading or organisation ("Übung", "Lösung", "Skript", "Readings",
  "Syllabus") keep the file out unread. A name that says lecture or exam decides nothing: the
  model reads the first pages. The costs are not alike. A file kept out wrongly costs the
  student one click, a wrong lecture costs a build, and a wrong exam paper skews which
  questions count as asked. On the 58 PDFs of the Entrepreneurship folder the names put 39 on
  the exam shelf and 9 of them were none: three "Rules for the ... exam" sheets, an "Exam
  Playbook", three case texts and two copies of a midterm. On 740 PDFs of Steffen's real
  course folders the name rules named a kind for 536.
- **The same file comes in once.** A file whose content the course already holds, under any
  name, stays out (sha256 of the bytes), so a paper kept twice does not double how often its
  questions were asked. It is caught before the model is asked, so adding a folder again pays
  nothing for what it took in before. A copy that differs in its bytes, a graded scan of the same midterm
  for instance, is not caught.
- **Junk is dropped unseen.** A file inside a hidden folder or a code project (`.venv`,
  `node_modules`, `build`) is not even listed: 14 of the 740.
- **The model reads every file a name does not keep out**: the file name and the first three
  pages, or the first page as a
  picture when they hold no text. One choice question over the eight kinds; the chosen kind
  is taken from `SORT_THRESHOLD` on, and below it the file stays out as unsure. A stray PDF
  never becomes a lecture; a lecture left out is listed and added with one click.
- **A failed request costs one file, a failed account the add.** A request the provider rejects
  for what one file holds leaves that file out as unsure and the others go on. A rejected key,
  an account without credit or no connection stops the add before anything is written, with
  what to do before adding the files again.
- **One choice, not eight predicates.** The first run on a real folder (2026-11-16,
  Entrepreneurship, 58 PDFs, 56 requests, 0.96 cents) asked one predicate per kind and took
  the most likely. All 11 decks and all 22 exam papers came in, the three exam rule sheets,
  the playbook and the case texts stayed out, the four midterm assignments were read as
  exercises and stayed out, and a one-page board picture came in as a lecture at 0.77. But
  predicates are judged one by one: an exam paper with a rules cover page scored 1.00 as exam
  and up to 1.00 as organisation, so the pick rested on a few hundredths or on the order of
  the kinds. With one choice the kinds share one whole, and a file that could be two kinds
  gets a low probability and stays out as unsure. On the same folder (0.38 cents) the choice
  put all 11 decks and all 22 papers on their shelves at 0.98 or more, the rule sheets at
  0.98 as organisation, and the three case texts that were unsure before as readings at 0.83
  or more. Two weak spots remain. The four midterm assignments, take-home case questions, are
  split: two in as exams at 0.60 and 0.78, two out as exercises at 0.64 and 0.82. The
  one-page board picture comes in as a lecture at 1.00, so no threshold keeps it out.
- **A midterm stays out by its name.** Steffen's call on the split: in his courses a midterm
  is a graded take-home assignment, not a paper whose questions come back, so "Midterm" in a
  name reads as an exercise and the file is kept out unread. A course whose midterm is a real
  exam adds it by hand as a past exam.
- **The threshold is not measured yet** ([#219](https://github.com/stegra05/lectern/issues/219)).
  `eval/sort-files.ts` measures it on labelled files: 224 from the same folders, labelled by
  their folder where their own name says nothing, plus 40 unrelated documents as junk.

## Given up

- **The checks that only flagged**, removed until calibrated ([#105](https://github.com/stegra05/lectern/issues/105)):
  slide support, concept belongs, same concept, same card, kind of slide, and the copy check.
- **A decision check for "leans on the slides".** The word rule beat it.
- **"An exam could ask this" and "the answer answers the question"** as grades (0.67).
- **A small generative model as a stand-in** where a provider has no decision API. Not built.

## Open

- Calibrate those checks one by one, and give the concept check its own slides:
  [#105](https://github.com/stegra05/lectern/issues/105).
