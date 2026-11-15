# Lectern v3: brief

Status: founding document, written 2026-11-13 from an intent interview with Steffen.
Branch: `v3`. The v2 app on `main` keeps shipping until v3 works end to end.

## Why v3

v2 is built around a single run: one PDF goes in, one deck comes out, and the app forgets it.
What is wrong with that, in Steffen's words:

- Cards often ask things the student already understands, or things that are not relevant.
- A lecture series cannot be uploaded.
- Tags are weak and there are no subdecks.
- The app shows a lot of information that gets skipped. The cards are rarely read in full.
- There is a lot to decide. The student should state a goal and the app should work towards it.

## Who it is for

Students in lecture-based courses who cannot build this for themselves with a coding agent.
Not power users.

## Promise

State a goal once. Get a course deck you can trust without reading every card, with a study plan
that fits your semester.

## Principles

1. **The course is the unit.** A course lives for a semester. Lectures are added over time.
2. **Goal first.** The student states a goal, the app decides the rest and accounts for it afterwards.
3. **Control before, account after.** No steering during the run, only a sign that it is working.
4. **Infer from the material, ask little.** Exam format and relevance come from the uploaded files.
5. **The method lives in tooling and presets.** The reference decks were made with very strong
   models. v3 must reach that quality with cheap ones, so validators, card roles, deck and tag
   builders and the schedule maths are code and presets. The model only fills slots.
6. **Delivered cards are never revised.** New lectures add cards, knowing what already exists.
7. **Lectern only touches its own Anki preset.** Never the options of any other deck.
8. **Grow in layers.** Each layer works end to end before the next one starts.

## Flow

1. **Create a course and drop in everything**: slides, scripts, past exams, exercise sheets.
   The app sorts the files by kind and lecture order. The student confirms on one screen.
2. **Three questions, once per course**: the goal (pass, good grade, top grade), the ready-by
   date, minutes per day. The exam format is inferred and shown as one line to confirm.
3. **Optional quiz**: mark concepts you already know on the concept map, plus a few
   multiple-choice checks. Easy formats only.
4. **The run**: no controls, only a sign that it is working.
5. **Result**: a summary on top, the concept map, the decisions the app took, the slide behind
   every card, and a proposed study plan to approve. Rest days are set here.
6. **Send to Anki**: a subdeck per lecture, tags, Lectern's own preset. Close the app.

Later in the semester the student adds a lecture. Only new cards are created and the plan is
recomputed.

This flow is the full picture. The base product asks only for the goal and has no quiz and no
study plan. See Scope.

## Decisions

| Topic | Decision |
|---|---|
| Interview | Three questions, once per course |
| Prior knowledge | Short quiz, multiple choice or similarly easy. Default: it lowers depth and pushes known concepts to the end of the order. It removes cards only for real prior knowledge, because one correct answer right after class mostly reflects recency |
| New lecture | Add only. No revision of delivered cards |
| Result view | Summary, concept map, decisions taken. Not a wall of cards |
| Schedule | Written into Anki on approval. Input is a ready-by date |
| Delivery | AnkiConnect add-on, the only path for now. It allows an adaptive plan and sees what is already in Anki |
| Keys | The student's own API key for now. Payment is out, but the provider layer must be easy to swap for hosted keys |
| Other inputs | Past exams and exercise sheets are accepted, detected automatically, confirmed by the student |
| Scope of courses | Lecture-based courses. Language courses are out |
| Codebase | Rewritten from scratch, plumbing included, using the learnings from v1 and v2 |
| Stack | Electron shell, headless TypeScript engine, one API-shaped boundary, a course as a folder of plain files |
| Kept from v2 | Seeing the slide a card belongs to, the concept map, easy Anki export |

## Card system

Rules are enforced by code, so a cheap model is forced into good cards.

- **Hard limits**: front at most 20 words, answer at most 25 words and at most 2 bullets, no
  yes/no questions. Cloze: one item per deletion, at most five, at most 8 words each.
- **Card roles** as a closed set with a slot template each: definition, reverse, contrast,
  chain, cloze list, name two, diagram, case anchor. The set must grow to cover every type of
  lecture (formulas, code, worked calculations).
- **Structure**: one root deck per course, a subdeck per lecture in course order. Tags for
  lecture, role, exam part and exam weight.
- **Relevance**: past exam questions are extracted and assigned to concepts on the concept map.
  Cards inherit "asked N times" from their concept. Without past papers a card is "core".
- **Provenance**: every card names its lecture and slide, and the slide can be shown.
- **Stable identity**: a note keeps its id when it is reworded.

Several card designs are wanted as options, and the cards should be smart: one system that
adapts its layout to the role and to the kind of lecture. This is a later, lower priority
requirement, explored in `design/`.

## Schedule

Deterministic code. Inputs: ready-by date, minutes per day, rest days, cards per lecture and
lecture dates. Output: new cards per day and the preset values, recomputed whenever a lecture
is added, from what is still unseen in Anki.

## Who does what

| Owner | Work |
|---|---|
| Code | Schedule maths, card validators, deck, subdeck and tag building, exam weight counting, note types, Anki delivery |
| Presets | Card roles, exam-format profiles, goal-to-depth mapping, card designs |
| Cheap model | Reading documents into the concept map, classifying uploads, extracting past exam questions, writing cards into a chosen role, writing the quiz |

## Architecture

- **A headless engine.** Everything that makes cards (reading documents, gates, card roles,
  deck building, schedule maths) is a plain TypeScript package with no interface code. It runs
  in the eval harness, from a command line, inside the app, and later on a server.
- **One API-shaped boundary.** The interface talks to the engine only through one narrow
  boundary. Moving to a website later means swapping the in-app channel for HTTP. Storage,
  network, PDF and Anki access are passed into the engine from outside.
- **Electron as the shell.** The engine runs in Node, the same runtime as the evals, and
  Playwright can drive both the interface in a browser and the packaged app.
- **A course is a folder of plain files**: the PDFs, the concept map, the cards. No database.
- **TypeScript throughout.**

## Scope

The base holds everything every later expansion depends on, and nothing that only one
expansion needs.

**Base product (v3.0)**

- A persistent course with several lecture PDFs, and adding a lecture later without duplicates.
- One question: the goal, which sets the depth.
- Atomic cards with hard limits and roles, a subdeck per lecture, tags, the slide behind
  every card.
- The result view: summary, concept map, decisions taken.
- Browsing the cards of a lecture, editing or removing a card, adding a card of your own.
- Sending through the add-on.
- The headless engine with evals against the reference deck.

**Done when** an 11-lecture course goes end to end into Anki, a cheap model holds up in a
blind comparison against the reference deck, and adding lecture 12 creates only new cards.

**Expansions, in order**

1. The feedback loop on the result: fixed actions on a lecture, a concept, a decision or a
   card. No free text. Marking a concept as known lives here.
2. The study plan, which brings the other two questions (ready-by date, minutes per day).
3. Past exams and exercise sheets: inferred exam format and exam weight.
4. The multiple-choice quiz.
5. A second card design, typed answers, and smart cards for every type of lecture.

The chosen design direction is recorded in `design/DIRECTION.md`.

**Vision, not planned**: reading progress back from Anki, hosted keys and payment, a website.

## Quality reference

Steffen's Entrepreneurship deck (636 vetted notes for 11 slide decks, made with a strong
model) is the reference from layer 1: run v3 on the same decks and compare blind. Its atomic
pass took 178 cards to 636 and the average answer from 59 words to 11.6.

## Not in v3

Delivery as a double-click file, language courses, revising delivered cards, a progress
dashboard, the Gemini decision model as a dependency.

## Open questions

- The exact quiz format.
- Which card design ships, and how far the visual identity of the app changes.
- The model line-up per provider.
- Whether reading progress back from Anki becomes its own layer after layer 4.

## What to carry over as knowledge

Nothing is copied by default. These are the lessons to rewrite against. Verify each on `main`
before relying on it.

- v1 failed on packaging and a split between server and webview. v2 has no backend: the whole
  pipeline runs in the webview, the Rust shell only handles the keychain, fetch and dialogs.
  See `docs/history.md`.
- Provider adapters carry quirks that cost real time to find (tool schema strictness, prefix
  edits, streaming in WebKit). Read the v2 adapters before writing new ones.
- A coverage ledger and a gate that rejects cards with feedback are what kept cheap models
  honest. v3 extends that idea with hard limits and roles.
- Anki note types that Lectern installs are upgraded only while the student has not edited them.
- A preset change once moved another course's decks to an unlimited preset and showed 433 due
  cards instead of 25. Hence principle 7.
- User-facing copy uses no em-dashes and names the fix in every error.
- The release pipeline (updater signing, Homebrew tap) works on `main` and should be understood
  before it is rebuilt.
- Steffen's two study kits (Entrepreneurship, Portuguese A2.1) hold the validators, card
  roles, writing rules and schedule formulas this brief is based on. Their locations are in the
  project memory, not in this repository.
