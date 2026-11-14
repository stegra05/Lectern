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

PDFs go into `<course folder>/slides/`. A build needs `OPENAI_API_KEY`.

## Test results

| Run | Result |
|---|---|
| Engine tests | 162 passed, 2 skipped (the live OpenAI tests, which need `LECTERN_LIVE=1`), 7 files, 4 s |
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

The two full runs happened at once by a coordination miss between the two sessions: each had
Steffen's yes, and the messages crossed. Total spent today on OpenAI: about 70 cents of the
50 dollars. Both results are kept. The reference deck has 636 notes for the same decks.

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

## Placeholder

`presets.ts` holds **one placeholder preset** used for every kind of lecture. Its plan table is
my guess, its examples are seven of the sample cards from `design/v3/samples.md`, its rules are
five lines. It exists so the pipeline runs. It is not one of the four presets Steffen will
approve, and no result from it should be read as the quality of the method.

A draft of the preset for concept courses now sits beside it as `concept-draft`, written from
the Entrepreneurship study kit and waiting for review: `engine-profile-concept.md`. A build uses
it only when the command names it. The roles `why`,
`name-two` and `cloze` validate but the placeholder never plans them.

Nothing is calibrated. Every check that goes through the decision model only flags.

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

- **Quality against the reference deck.** Counts are comparable (596 and 658 against 636). No
  blind comparison and no coverage check has been made. My reading of a sample is above.
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

1. Decide how course administration is kept out: a calibrated slide label, a rule in the
   preset, or both. It is the largest visible defect and it multiplies through recurrence.
2. The concept-course preset, written against the reference deck, replacing the placeholder.
3. Calibration data from these two runs: the flagged concepts and card pairs are ready-made
   examples to label. Start with "same card" and "concept belongs", which already look precise.
4. A first eval: coverage of the reference deck's notes by concept, and a blind sample.
5. A small run on Datenbanken and Operations Research once code and formula cards have a preset.

## Follow-ups outside my paths

- `pnpm-lock.yaml` is shared. My commit `f5d004a` includes the entries of `packages/app`, which
  another session added but has not committed. `pnpm-workspace.yaml` (the `electron` line) is
  theirs and I left it uncommitted.
- Root `pnpm lint` fails locally on `design/v3/cards-lamp/build-gallery.mjs`.
