# Lectern v3 engine: report on milestone 1

Written 2026-11-14. Goal: `engine-goal.md`. Plan: `engine-plan.md`. Branch `v3`, local commits
`c768343` to `fb4d017` plus the commit of this report. Nothing pushed.

## Verdict

All nine criteria of the goal are met offline. No model has been called for real, so nothing
here says anything about card quality yet. `engine-decisions.md` arrived during the work and
is not applied: see "Decisions file" below, it needs a yes.

## What was built

`packages/engine` (`@lectern/engine`): 1,876 lines of source, 1,506 lines of tests, no interface
code, no build step (Node runs the TypeScript directly).

| Criterion | Where |
|---|---|
| 1 Plan first | `docs/v3/engine-plan.md`, commit `c768343`, before any code |
| 2 Package, one command each | `pnpm --filter @lectern/engine test` and `pnpm --filter @lectern/engine typecheck` |
| 3 CLI build | `node packages/engine/src/cli.ts build <course folder> [--goal pass\|good\|top]` |
| 4 Validators | `src/cards/validate.ts`, `typed.ts`, `id.ts`, `assemble.ts` |
| 5 One model port, scripted fake | `src/ports.ts`, `src/adapters/fake.ts`, `test/pipeline.test.ts` |
| 6 Add a lecture | same test, "adding a lecture and building again" |
| 7 Outline | `node packages/engine/src/cli.ts outline <course folder>` |
| 8 Real adapter | `src/adapters/anthropic.ts`, `test/anthropic.live.test.ts` (runs only with `LECTERN_LIVE=1`) |

A build reads `<course>/slides/*.pdf` and writes `course.json`, `lectures/NN/lecture.json`
(topics, concepts with slide numbers, every unused slide with a reason),
`lectures/NN/cards/<id>.json` (all 16 Q&A or 13 cloze fields of `FIELDS.md`), `decisions.json`
and `runs/NNN.json` (model, calls, tokens, cost, duration per phase). It prints the phases
read, map, write, check as JSON lines.

How the method lives in code:

- The model returns flat slots only: concept, role, slide, front, answers, labels, extra. Code
  writes Back, Slots, the deletions of a cloze list, the key term mark, Typed, Lecture, Topic,
  Source, Excerpt, Slide and Key.
- Ten roles are built: definition, reverse, contrast, chain, name-two, why, case, formula,
  cloze, cloze-list. `code` and `diagram` are rejected for now.
- A rejected card goes back with the exact problems ("front has 21 words; the limit is 20"),
  at most twice, keeping its id and role. Then it is dropped and counted in a decision.
- The map of a lecture is checked the same way: every slide is used or left out with a reason,
  slide numbers exist, names are unique. One retry, then code closes the gaps.
- A concept an earlier lecture already has is dropped by code, and a question the course
  already asks is rejected, also across lectures.

## Test results

| Run | Result |
|---|---|
| `pnpm --filter @lectern/engine test` | 94 passed, 1 skipped (the live test), 5 files, 3 s |
| `pnpm --filter @lectern/engine typecheck` | clean |
| `pnpm exec eslint packages/engine` | clean |
| Root `pnpm test` (the v2 suite) | 406 passed, 12 skipped, unchanged |

By file: validators 42, cards (assembly, typed answers, ids) 18, tree and lecture numbering 10,
whole pipeline 24. The pipeline test uses real PDFs made in the test, the real pdf.js reader and
real files in a temp folder; only the model is scripted. It makes three mistakes on purpose:
a yes/no question (fixed on rewrite, same id), an answer of 30 words (never fixed, dropped),
and a question lecture 1 already has (rejected across lectures, fixed on rewrite).

Also checked by hand, offline: the reader on the 11 Entrepreneurship slide decks. 356 slides,
none without text, about 35,000 tokens of text, read in 0.5 s. The lecture numbers 1 to 11
came out right from the file names.

## Decisions taken and why

1. **Slots, not fields.** One flat draft shape for every role. It keeps the JSON schema free of
   unions, which every provider's strict mode accepts, and it makes "the model only fills
   slots" literal.
2. **Phases are course-wide and nothing is saved until the end.** That is what the run screen
   shows. Cost: a failed run loses its paid work.
3. **`course.json` is the marker for "built".** It is written last. A lecture listed there is
   never touched again, which is what makes the byte-identical test trivial.
4. **Lecture numbers** come from the leading number of the file name when free, otherwise the
   next free one, and never change.
5. **Card ids** are `<lecture>-<concept>-<role>-<n>`, for example `02-bird-in-hand-reverse-1`.
   Readable, and independent of the wording.
6. **Goal sets depth only**: 2, 3 or 4 cards per concept. Default `good`.
7. **Text only.** Slides reach the model as extracted text. Slides without text are left out
   with that reason.
8. **A light grounding rule**: at least one term of the answer must appear on the cited slide.
   v2 showed that off-source answers are the main weakness of cheap models.
9. **Yes/no openers in English and German.** "Was" is left out because it means "what" in
   German, as v2 learned.
10. **Cloze text at most 45 words.** Not in the brief; taken from the Entrepreneurship kit.
11. **Anthropic (`claude-haiku-5-5`) as the first adapter.** Same list price as `gpt-6-luna`
    in the v2 config ($0.10 and $0.50 per million tokens). Superseded by the decisions file.
12. **The live test needs `LECTERN_LIVE=1`**, not just a key, so a key in the shell cannot
    spend money during a normal test run.
13. **The outline is read back from the card fields.** No second copy of the question and
    answer is stored.

## What failed along the way

All found by the tests and fixed:

- Word counting split `H<sub>2</sub>O` into three words.
- A quoted opener (`"Are" ...`) slipped past the yes/no rule.
- The outline put a space before the full stop after a marked key term.
- zod writes integer bounds into the JSON schema, which Anthropic's structured output does
  not accept. Slide numbers are plain numbers now and checked in code.
- vitest picked up the root config and found no tests; the package has its own config now.

No criterion needed more than one attempt.

## Unverified

- **No live call.** The Anthropic adapter has never talked to the API. Its request passes the
  SDK's types, and the CLI error path was run against an address that cannot be reached. The
  prompts have never met a real model.
- **Card quality**: unknown until a real run and an eval.
- **Cost**: the prices are constants from the v2 config, not checked against a bill. My
  estimate for the 11 reference decks on a model at $0.10 and $0.50: 10 to 40 cents.
- **Slide images**: the Slide field names a PNG that nothing renders yet.
- **Rate limits** with 4 calls in parallel.
- **A crash in the final write burst** could leave a lecture folder that `course.json` does not
  list. The next build would write over it, but stray card files could remain.
- **Excerpt and grounding heuristics** on real cards, and German decks in general.

## Decisions file

`docs/v3/engine-decisions.md` appeared at 10:22 while I was building. It records an interview
with Steffen and says it overrides the goal. I did not write it and did not commit it. I
finished to the goal as written, because it changes the folder format and the ports, and my
goal says to stop and ask in that case. What differs from what is built:

| Decision | Built now | Change needed |
|---|---|---|
| 10 One readable YAML file per lecture | One JSON file per card | Folder format. Small in code, breaks criterion 3 as written |
| 2 OpenAI adapter first, eval budget of 50 dollars | Anthropic adapter | New adapter behind the same port. I spend nothing without a direct yes |
| 1 Slides with little text as an image | Text only | Model port gains attachments, reader renders pages |
| 6 Checking port with a decision model | One rule in code | New port |
| 3 Goal changes coverage and depth | Depth only | Map marks core concepts |
| 5 Dropped cards listed with concept and reason | Counted per lecture | Small |
| 7 Estimate before the run, hard cap | Cost recorded after | New event and a stop |
| 8, 9 Code and drawing cards | Rejected roles | Larger, needs a benchmark |
| 11 Recurring concepts weigh more, one vocabulary | No repeats only | Map step across lectures |
| 4 Language of the slides | Done, in the system prompt | None |

## Proposed next milestone

"First real run": apply the decisions that change the format before anything depends on it,
then meet a real model.

1. Card files per lecture as YAML (10), dropped cards with reasons (5).
2. OpenAI adapter (2), checked against the v2 adapter's lessons, with the live test.
3. One real run on the 11 Entrepreneurship decks, with the estimate and the cap (7) in place.
4. A first eval against the reference deck: counts, limit violations, and a blind sample.
5. Slide images for low-text slides (1) only after the first run shows how much text-only
   reading loses.

## Follow-ups outside my paths

- Root `pnpm lint` fails locally on `design/v3/cards-lamp/build-gallery.mjs` (not known to the
  TypeScript project). The file is untracked today; once it is committed, the lint step of CI
  fails. `design/` is not mine to touch.
