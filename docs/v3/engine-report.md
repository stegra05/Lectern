# Lectern v3 engine: report

Updated 2026-11-14 after milestone 2. Goal: `engine-goal.md`. Decisions: `engine-decisions.md`.
Plan with both milestones: `engine-plan.md`. Branch `v3`, local commits only, nothing pushed.
Milestone 1 ends at `15d00fc`, milestone 2 is `f5d004a`.

## Verdict

Everything that can be done without a paid call is done and tested: the engine runs the seven
steps of "How cards are created" end to end against scripted models. No real model has been
called yet, so nothing here says anything about card quality. The first real run waits for
Steffen's yes in this session (criterion 10 of milestone 2).

## Commands

| What | Command |
|---|---|
| Tests | `pnpm --filter @lectern/engine test` |
| Typecheck | `pnpm --filter @lectern/engine typecheck` |
| Lint | `pnpm exec eslint packages/engine` |
| Estimate, free | `node packages/engine/src/cli.ts estimate <course folder> [--goal pass\|good\|top] [--model gpt-6-luna]` |
| Build, paid | `node packages/engine/src/cli.ts build <course folder> [--goal ...] [--profile ...] [--model ...]` |
| Outline | `node packages/engine/src/cli.ts outline <course folder>` |

PDFs go into `<course folder>/slides/`. A build needs `OPENAI_API_KEY`.

## Test results

| Run | Result |
|---|---|
| Engine tests | 142 passed, 2 skipped (the live OpenAI tests, which need `LECTERN_LIVE=1`), 6 files, 3 s |
| Typecheck, lint, format | clean |
| Root `pnpm test` (the v2 suite) | 406 passed, 12 skipped, unchanged |

By file: validators 57, cards 20, tree and lecture numbering 14, plan, clashes and estimate 11,
whole pipeline 40. The pipeline test uses real PDFs, the real pdf.js reader and renderer and
real files; only the two models are scripted.

Checked by hand, offline, on the 11 Entrepreneurship decks (356 slides): the estimate command
runs in under two seconds and gives, on `gpt-6-luna`:

| Goal | Cards expected | Estimate | Cap |
|---|---|---|---|
| pass | 91 | 5 cents | 25 cents |
| good grade | 356 | 11 cents | 32 cents |
| top grade | 712 | 19 cents | 56 cents |

On `gpt-6.1-terra` a good-grade run is estimated at 83 cents. These figures come from constants
I chose; the first real run will show how far off they are.

## What was built

`packages/engine`: 3,328 lines of source, 2,392 lines of tests, no interface code, no build step.

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
| 10 | First real run only after a yes | open |

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

## Placeholder

`presets.ts` holds **one placeholder preset** used for every kind of lecture. Its plan table is
my guess, its examples are seven of the sample cards from `design/v3/samples.md`, its rules are
five lines. It exists so the pipeline runs. It is not one of the four presets Steffen will
approve, and no result from it should be read as the quality of the method. The roles `why`,
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
| Decision 7: stop cleanly at the cap | The run fails with a message and saves nothing. Calls already under way (up to four) still finish | A stopped run loses its paid work |
| Thinking off for recall tasks | Fill, repair and split run on effort `low` | Whether the model accepts less than `low` is unverified |
| Milestone 1: Anthropic adapter | Removed, no backward compatibility | |
| Milestone 1: a rejected card kept its role and went back twice | Still twice, now with the split step first for cards that are too long | |

New in the files, not in `FIELDS.md`: `flags` on a card and on a concept, and `diagram` on a
diagram card. The interface session should know these exist.

## Unverified

- **No live call.** Neither OpenAI adapter has talked to the API. Both pass the types of the
  installed SDK, and the error path was run against an address that cannot be reached.
- **Card quality, map quality, decision quality**: unknown until a real run.
- **Prices**: constants from the v2 config and the decisions file, not checked against a bill.
- **Slide pictures**: rendering works on generated PDFs and was looked at once. Not tried on
  the real decks' fonts and figures. The Slide field still names a PNG that nothing saves.
- **Prompt caching**: the lecture comes first in every request so OpenAI's cache can cover it.
  Whether it does, and at what share, is unmeasured.
- **Rate limits** with four calls in parallel.
- **The two extra test courses** are readable from this session (21 and 17 PDFs). Nothing was
  run on them. German yes/no openers and code cards have never met real slides.

## Proposed next steps

1. One real run on the Entrepreneurship decks with `gpt-6-luna`, goal top grade: estimated
   19 cents, capped at 56 cents. Then read the cards, the flags and the run file together.
2. Compare with the reference deck: counts per lecture, share of cards dropped or split, and a
   blind sample. That is the start of the eval.
3. Calibration data from that run: the flagged cases are the first examples to label.
4. The four real presets, starting with the concept course.
5. A small Datenbanken and Operations Research run once code and formula cards have a preset.

## Follow-ups outside my paths

- `pnpm-lock.yaml` is shared. My commit `f5d004a` includes the entries of `packages/app`, which
  another session added but has not committed. `pnpm-workspace.yaml` (the `electron` line) is
  theirs and I left it uncommitted.
- Root `pnpm lint` fails locally on `design/v3/cards-lamp/build-gallery.mjs`.
