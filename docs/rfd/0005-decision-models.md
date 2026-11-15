# RFD 5 · Decision models judge, and only measured checks act

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| **State** | decided                                                           |
| **Date**  | 2026-11-14, calibration 2026-11-15                                |
| **Code**  | `packages/engine/src/decide.ts`, `adapters/openai.ts`             |

> **In one breath.** Every yes-or-no question goes to a cheap decision model, but nobody knows
> how accurate it is, so a check may only drop a card once we have measured its threshold on
> our own labels.

## Decision

- **Closed questions go to a decision model**: kind of course, kind of slide, concept belongs,
  same concept, kind of fact, worth of a fact, organisation, slide support, same card.
  OpenAI's `POST /v1/decisions` on `gpt-6-luna` (GA since 2026-10-22; the SDK documents 1 to
  200 questions per request, so the adapter sends 200). Google's `gemini-decision-1` exists
  but has no adapter. Neither returns explanations or publishes accuracy. About 2,000
  decisions for a course cost two to three cents.
- **A free rule first** where one exists (the slide check's word overlap). Only cards the rule
  cannot settle are asked.
- **The input is as small as the question.** A card alone for the organisation check, one slide
  alone for the slide check, one fact alone for its worth.
- **Calibration before action.** A strong model labels a few hundred examples from
  Entrepreneurship, Steffen spot-checks about thirty, and a threshold is set. Until then a
  check only flags. Today only the organisation check acts: at 0.2 or more the card is dropped
  without repair, because no rewording fixes a fact about course administration.

## Why

Measured on 2026-11-15 (1.5 cents, built positives and negatives):

| Check                  | Whole lecture as input       | Smallest input                  |
| ---------------------- | ---------------------------- | ------------------------------- |
| Slide supports card    | 50 of 66 wrong accepted, 61% | slide alone: 12 of 66, 90%      |
| Concept belongs        | 5 of 55 wrong accepted, 95%  | concept's slides: 0 of 55, 99%  |

With a whole lecture as input, yes/no questions say yes to nearly everything. As a grader
over 1,150 cards (10.8 cents): organisation separates at 0.88, slide meta at 0.92, worth at
0.87. "An exam could ask this" put every card above 0.9 and is useless.

Flags so far find little: in the concept-preset run, 21 of 24 flagged cards were sound.

## Given up

- **A decision check for "leans on the slides".** The word rule beat it.
- **"An exam could ask this" and "the answer answers the question"** as grades (0.67).
- **A small generative model as a stand-in** where a provider has no decision API. Not built.

## Open

- Calibrate the five checks that only flag, and give the concept check its own slides:
  [#105](https://github.com/stegra05/lectern/issues/105).
