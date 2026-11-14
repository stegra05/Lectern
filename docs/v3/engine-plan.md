# Lectern v3 engine: plan for milestone 1

Written 2026-11-14, before any code. Goal: `docs/v3/engine-goal.md`. Product: `docs/v3/brief.md`.

## Package layout

`packages/engine` (`@lectern/engine`), plain TypeScript, run by Node directly (type stripping, no
build step). Dependencies: `zod`, `pdfjs-dist`, `@anthropic-ai/sdk`. No interface code.

```
src/
  api.ts            the boundary: Command, Event, createEngine(ports)
  ports.ts          ModelPort, PdfPort, Store
  build.ts          the build command: the four phases
  tree.ts           checks and repairs the model's map of a lecture
  outline.ts        the Markdown outline
  course.ts         the shapes and paths of the course folder
  prompts.ts        the three prompts (map, write, rewrite) and their reply schemas
  cards/
    roles.ts        the closed role set, one slot template per role
    words.ts        word counting and text helpers, shared by all limits
    validate.ts     pure validators: draft in, list of problems out
    typed.ts        the typed answer rule
    assemble.ts     draft to card fields: Back, Slots, Text, Typed, Source, Excerpt
    id.ts           stable card ids
  adapters/         node file store, pdf.js reader, Anthropic model, scripted fake model
  cli.ts            command line: build, outline
test/               validators, cards, tree, whole pipeline offline with incremental build, live
```

## The boundary

One function, JSON in and JSON out, so the in-app channel can later be swapped for HTTP
(POST a command, stream the events).

```ts
createEngine(ports).run(command, emit): Promise<void>

Command = { type: 'build', course, goal? }      // goal: 'pass' | 'good' | 'top', kept in course.json
        | { type: 'outline', course }
Event   = { type: 'phase', phase: 'read' | 'map' | 'write' | 'check', status: 'started' | 'done', ... }
        | { type: 'progress', phase, done, total }
        | { type: 'built', lectures: [{ number, title, cards }], cards, dropped, costUsd, durationMs }
        | { type: 'outline', markdown }
        | { type: 'failed', message, fix }
```

`course` is the folder name inside the store's root. Ports passed in from outside:
`Store` (read, write, list files), `PdfPort` (PDF bytes to text lines per slide), `ModelPort`
(one method: `complete({ task, system, prompt, schema })` returns parsed JSON plus token usage
and cost), and a clock. The command line prints each event as one JSON line.

## Course folder

```
<course>/
  slides/*.pdf                    input, one PDF per lecture, course order = file name order
  course.json                     format version, name, goal, lectures: number, title, file, sha256, slides
  lectures/02/lecture.json        topics > concepts with slide numbers; slides left out, a reason each
  lectures/02/cards/<id>.json     one file per card: id, note type, concept, slide, every field of FIELDS.md
  decisions.json                  decisions taken, written by code from facts, one line each
  runs/001.json                   one file per build: model, calls, tokens, cost, duration per phase
```

A lecture keeps its number forever: the leading number of the file name if free, otherwise the
next free one. A lecture that has a folder is never built again, so its card files are never
touched. Card files hold no timestamps.

## Pipeline

The phases are course-wide, as the run screen shows them.

1. **Read all lectures.** No model. New PDFs are read into text lines per slide. Slides without
   text are left out with a reason (the engine does not see pictures yet).
2. **Map topics and concepts.** One model call per new lecture: slide texts plus the concept
   names of earlier lectures in, and out a title, topics, concepts with slide numbers, and
   slides to leave out with a reason. Code checks the result: slide numbers exist, names are
   unique, and every slide is either used by a concept or left out. One retry with feedback,
   then code closes the gaps itself with a stated reason.
3. **Write cards.** One model call per topic: the concepts with their slide text, the role
   catalogue, and the depth from the goal (cards per concept: pass 2, good 3, top 4). The model
   returns flat drafts: concept, role, slide, front, answers, labels, extra. Each draft gets its
   id here.
4. **Check cards.** Every draft runs through the validators. Rejected drafts go back to the
   model with the exact problems, at most two rounds, same id and same role. A draft that still
   fails is dropped and counted in a decision. Accepted drafts are assembled into fields and
   written.

## How limits and roles are enforced

- **Roles are a closed table** in `roles.ts`. Each role says which slots it uses, how many
  answers and labels, and how code builds Back, Slots or Text from them. The model never writes
  HTML, list markup, slot labels, cloze numbers of a cloze list, or any provenance field.
  This milestone builds ten roles: definition, reverse, contrast, chain, name-two, why, case,
  formula, cloze, cloze-list. `code` and `diagram` are in the field contract and come later.
- **Validators are pure functions** over a draft and its slide text: front at most 20 words,
  answer at most 25 words and at most 2 bullets, extra at most 40 words, no yes/no opener, the
  shape the role promises, cloze rules (numbers from 1 without repeats, at most 5 deletions,
  at most 8 words each, no hints, balanced braces), slot limits (at most 6, at most 4 words
  each), a slide that exists and belongs to the concept, at least one answer term found on the
  cited slide, and no duplicate front within the course.
- **Typed answers** are decided by code only: role reverse, case, cloze or cloze-list, expected
  text at most 3 words and 30 characters, no maths, markup or line break. For Q&A the field
  holds the term in the concept's casing, for cloze the word `on`.
- **Ids** are `<lecture>-<concept slug>-<role>-<n>`, assigned once and stored in the file. The
  wording is not part of the id, so rewording keeps it.
- **Excerpt and Source** come from the slide text and the tree, never from the model.

## Model access

One port. `adapters/fake.ts` is a scripted model for tests. `adapters/anthropic.ts` is the real
one (`claude-haiku-5-5`, structured output through a JSON schema, $0.10 in and $0.50 out per
million tokens as configured in v2). Its test runs only when `LECTERN_LIVE=1` is set, so a key in
the shell never spends money by accident.

## Deferred

- Slide pictures: rendering slides to PNG (the Slide field holds the file name only) and
  letting the model see slides. Text-only reading is the largest known quality risk.
- Roles `code` and `diagram`. Asked and Part stay empty until past exams exist.
- Queries for the interface, editing and adding cards, sending to Anki, evals, themes, study
  plan, quiz, past exams. A changed PDF behind a built lecture is ignored.

## Changed by engine-decisions.md

Steffen's eleven decisions of 2026-11-14 (`engine-decisions.md`), confirmed by the session that
set the goal. Where this section differs from the text above, this section holds.

| Decision | Change to the plan |
|---|---|
| 1 Reading | Text is still extracted locally. A slide with under 100 characters of text is also rendered and sent to the model as an image. `PdfPort` gains `renderSlides`, a model request gains `images`. No slide is left out for lacking text |
| 2 Model | The real adapter is OpenAI (`adapters/openai.ts`), the Anthropic one is removed. The default model waits for the eval |
| 3 Goal | A preset per goal sets coverage and depth. Pass: core concepts only, one card. Good: every concept, two cards. Top: every concept, four cards, with cases and contrasts. The map marks each concept as core or not |
| 4 Language | Already in the system prompt |
| 5 Failed cards | `lecture.json` lists each dropped card with its concept and the problems |
| 6 Checking | New `CheckPort`. A free rule passes a card when half of its answer terms are on the slide. The rest goes to the port, which for OpenAI is its Decisions API (in the installed SDK). A "no" sends the card back for a rewrite |
| 7 Cost | New command `estimate`, and every build emits the estimate before the first model call. The build stops with a failure when the real cost passes three times the estimate (at least 25 cents). `ModelPort` gains `price` |
| 8, 9 Card kinds | The role set is the full twelve of the field contract. `code` carries a listing that must be found on the slide. `diagram` carries a structured description (matrix, sequence or cycle) with a validator. No renderer yet: the Diagram field falls back to the slide image |
| 10 Card files | `lectures/02/cards.yaml`, one readable file per lecture, replaces one JSON file per card. Files of earlier lectures stay byte-identical |
| 11 Whole course | No repeats across lectures (as before). A concept that comes up again keeps its id and its stored name (one vocabulary) and gets one more card in the later lecture |

The card-writing step sits behind one seam, `writer.ts` (write drafts, rewrite rejected
drafts). Its strategy and prompts are provisional until Steffen's input on how cards are
created arrives. Everything else (folder, tree, validators, ports, fake model, CLI, outline)
does not depend on it.

## Open questions

- PDFs live in `slides/` inside the course folder, and a command carries the course as a
  folder name rather than a path. To confirm.
