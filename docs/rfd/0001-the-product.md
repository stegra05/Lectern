# RFD 1 · A course in, a deck you can trust out

|           |                                                       |
| --------- | ----------------------------------------------------- |
| **State** | decided                                               |
| **Date**  | 2026-11-13, from an intent interview with Steffen     |
| **Read**  | first. Every other RFD assumes this one               |

> **In one breath.** State a goal once. Get a course deck you can trust without reading every
> card, made by cheap models, sent to Anki.

## Why v3

v2 is built around a single run: one PDF in, one deck out, and the app forgets it. In
Steffen's words, what is wrong with that:

- Cards ask things the student already understands, or things that are not relevant.
- A lecture series cannot be uploaded.
- Tags are weak and there are no subdecks.
- The app shows a lot that gets skipped. Cards are rarely read in full.
- There is too much to decide. The student should state a goal and the app work towards it.

## Who it is for

Students in lecture-based courses who cannot build this for themselves with a coding agent.
Not power users. Language courses are out.

## Principles

1. **The course is the unit.** A course lives for a semester. Lectures are added over time.
2. **Goal first.** The student states a goal, the app decides the rest and accounts for it after.
3. **Control before, account after.** No steering during the run, only a sign that it works.
4. **Infer from the material, ask little.** Exam format and relevance come from the files.
5. **The method lives in tooling and presets.** See [RFD 2](0002-code-decides.md).
6. **Delivered cards are never revised.** New lectures add cards, knowing what exists.
7. **Lectern only touches its own Anki preset.** A preset change once moved another course to
   an unlimited preset and showed 433 due cards instead of 25.
8. **Grow in layers.** Each layer works end to end before the next one starts.

## The flow, in full

1. Create a course and drop in everything: slides, scripts, past exams, exercise sheets.
2. Three questions, once per course: the goal (pass, good grade, top grade), the ready-by
   date, minutes per day. The exam format is inferred and shown as one line to confirm.
3. Optional quiz: mark known concepts on the map, plus a few multiple-choice checks.
4. The run: no controls, only a sign that it is working.
5. The result: a summary, the map, the decisions the app took, the slide behind every card,
   a proposed study plan to approve.
6. Send to Anki: a subdeck per lecture, tags, Lectern's own preset. Close the app.

Later in the semester the student adds a lecture. Only new cards are made.

## What v3.0 holds, and what comes after

The base holds everything every later expansion depends on, and nothing only one needs.

**v3.0, the base.** A persistent course of several lecture PDFs, adding a lecture later
without duplicates. One question: the goal. Atomic cards with hard limits and roles, a subdeck
per lecture, tags, the slide behind every card. The result view. Browsing, editing, removing
and writing cards. Sending through AnkiConnect. The headless engine with evals.

**Done when** an 11-lecture course goes end to end into Anki, a cheap model holds up in a blind
comparison against the reference deck ([RFD 14](0014-the-quality-bar.md)), and adding lecture
12 creates only new cards.

**Expansions, in order:** 1 the feedback loop ([RFD 12](0012-feedback-loop.md)), 2 the study
plan, 3 past exams and exam weight, 4 the multiple-choice quiz, 5 a second card design, typed
answers and smart cards for every kind of lecture. Each is a milestone on the
[roadmap board](https://github.com/users/stegra05/projects/3).

**Not in v3:** delivery as a double-click file, language courses, revising delivered cards, a
progress dashboard. **Vision, not planned:** progress read back from Anki, hosted keys and
payment, a website.

## Lessons carried over from v1 and v2

Nothing is copied. These are the lessons to rewrite against; verify each on `main` first.

- v1 failed on packaging and a split between server and webview.
- Provider adapters carry quirks that cost real time (tool schema strictness, prefix edits,
  streaming in WebKit). Read the v2 adapters before writing a new one.
- A coverage ledger and a gate that rejects cards with feedback kept cheap models honest.
- Note types Lectern installs are upgraded only while the student has not edited them.
- The release pipeline on `main` (updater signing, Homebrew tap) works. Understand it before
  rebuilding it.
- Steffen's two study kits (Entrepreneurship, Portuguese A2.1) hold the validators, roles,
  writing rules and schedule formulas this RFD rests on. Their paths are in his project memory.

## Open

- The model line-up per provider: [#130](https://github.com/stegra05/lectern/issues/130).
- The exact quiz format: [#127](https://github.com/stegra05/lectern/issues/127).
