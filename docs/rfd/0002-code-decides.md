# RFD 2 · Code decides, the model fills slots

|           |                                                                       |
| --------- | --------------------------------------------------------------------- |
| **State** | decided                                                               |
| **Date**  | 2026-11-13 (brief), 2026-11-14 (second engine interview)              |
| **Code**  | `packages/engine/src/plan.ts`, `writer.ts`, `cards/validate.ts`        |

> **In one breath.** The reference decks were made with very strong models. v3 has to reach
> that with cheap ones, so everything that can be a rule is code, and the model only writes
> words into forms that code has already shaped.

## Decision

Steffen's principle: "As much tooling and help for LLMs as possible is good."

| Owner         | Work                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code          | How many cards exist and of what shape, ids, validators, deck, subdeck and tag building, exam counting, note types, delivery, schedule |
| Presets       | Card roles, examples and rules per kind of course, goal to card count, card designs                                                    |
| Cheap model   | Reading slides into facts, sorting them into a map, writing one card per planned slot, answering past exam questions                    |
| Decision model | Every closed-set judgement: kind of course, kind of slide, does a concept belong, same concept, kind of fact, worth, organisation, slide support, same card |

Rules that follow from it:

- The model never decides how many cards exist or what shape they take.
- The model never writes HTML, list markup, slot labels or provenance. It fills a small form per
  card type with the limits written into the field descriptions.
- A check drops or flags. It never rewrites a card.
- Writing, repair and split run at effort `low`: they are recall, not reasoning.

## Why

v1 and v2 let the model choose the cards and ended with a rewriting review pass. Their evals
showed maps split too finely, a stop rule that accepted a third of the slides uncovered, and a
review doing heavy repair. In Steffen's hackathon projects the reliable pattern was the
reverse: the model writes only words, code owns numbers and decisions, bad output is dropped by
a rule and a fallback stands in. One outside report found a model used as a checker missing
errors and "correcting" good cards.

## Given up

- **A rewriting review pass** at the end. The end step only drops identical questions and
  flags look-alikes ([RFD 4](0004-lecture-to-cards.md)).
- **A blend of card kinds with weights** per fact. One kind per fact, chosen by a decision model.
- **A check that a card "tests exactly one thing".** Considered, left out for now.
