# RFD 14 · The quality bar is Steffen's own deck

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| **State** | decided, measurement ongoing                                      |
| **Date**  | 2026-11-13, measured 2026-11-14 and 2026-11-15                    |
| **Code**  | `packages/engine/eval/refdeck.ts`, judge rules in `eval/JUDGE.md` |

> **In one breath.** Run the engine on the 11 Entrepreneurship decks and hold the result
> against the 636 notes Steffen vetted for the same course. Form is already fine. Coverage is
> the gap.

## Decision

The reference is Steffen's Entrepreneurship deck: 636 vetted notes for 11 slide decks (356
slides), made with a strong model. Its atomic pass took 178 cards to 636 and the average
answer from 59 words to 11.6. The eval exports it from Anki and a judge (so far Claude Haiku, spot-checked by hand) decides
for each reference note whether a run has the same fact, only the concept, or nothing. Every engine change that claims better cards is
measured this way, and v3.0 is done only after a blind comparison by a person
([#137](https://github.com/stegra05/lectern/issues/137)).

## What the measurements say

**Form is fine.** No hard-limit violation in any full run. Questions average about 10 words,
answers about 10.5 (reference 11.6).

**Coverage is the gap.** Of the 636 notes, after the concept preset (strict judge):

| Where the note stands                  | Notes      |
| -------------------------------------- | ---------- |
| Same fact on a card                    | 192 (30%)  |
| Missed, the slide text states it       | 137 (22%)  |
| Missed, only in a picture              | 101 (16%)  |
| Missed, not on the slides at all       | 206 (32%)  |

With past exam questions as cards, coverage rose to 246 notes (39%), and a card answers 34 of
the 52 questions of four papers the engine never saw ([RFD 8](0008-past-exams.md)). About a
third of the reference comes from cases, videos and readings, not slides. Notes
asked 9 or more times in past exams were covered best (38 percent), notes asked once or never
worst (27).

**Two runs on the same slides differ** by up to 20 percent per lecture (658 against 596 cards).
A difference of about 2 points needs two or three runs per variant before it is believed.

**Steffen's own verdicts** on 62 cards: 41 keep, 9 right fact but bad card, 5 not worth a card,
7 junk.

## Test courses

Entrepreneurship is the reference. Grundlagen Datenbanken and Operations Research test the
formula and programming presets ([RFD 7](0007-presets.md)). Datenbanken has a deck from AnkiTUM
as a reference, judged weak: about 140 cards, not atomic, for 9 of 21 chapters.

## Open

- The blind comparison: [#137](https://github.com/stegra05/lectern/issues/137).
- Coverage at the fact level: [#108](https://github.com/stegra05/lectern/issues/108).
- Facts only in pictures: [#106](https://github.com/stegra05/lectern/issues/106).
