# RFD 4 · How a lecture becomes cards

|           |                                                                                  |
| --------- | -------------------------------------------------------------------------------- |
| **State** | decided, revised by measurement                                                  |
| **Date**  | 2026-11-14 (interviews), 2026-11-15 (slide-by-slide reading, worth score)        |
| **Code**  | `packages/engine/src/build.ts`, `mapper.ts`, `plan.ts`, `writer.ts`, `clash.ts`  |
| **Steps** | [architecture, section 3](../architecture.md#3-the-pipeline-step-by-step)        |

> **In one breath.** Read every slide on its own, sort what it teaches into concepts and
> facts, let code pick the facts worth most under the goal, fill one form per card, gate it,
> drop what still fails.

## Decision

1. **Read.** Text is extracted locally, without the lines every slide repeats. Each slide is
   then read by the model on its own, with its picture, against the cached lecture. A set named
   on a slide stays one fact.
2. **Map.** One call per lecture sorts the facts into topics and concepts. Code settles the
   map and repairs it itself. A decision model then asks which kind each fact is. Nine kinds: definition, contrast, list,
   sequence, formula, code, case, diagram, cause.
3. **Worth.** A decision model scores every fact on four levels (not examinable, detail,
   examinable, core). It orders, it never drops.
4. **Plan.** Code alone decides how many cards exist. The goal is cards per slide (pass 0.5,
   good 1, top 1.8, the reference deck's density), shared over all lectures of one build.
   Past exam answers first ([RFD 8](0008-past-exams.md)), then the facts worth most. The kind
   of a fact and the preset pick the card type.
5. **Fill.** One call per planned card, the whole lecture as cached context, one example of
   the card type from the preset. Key terms exactly as on the slides, the sentence reworded,
   in the language of the slides.
6. **Gate.** Hard limits, then "leans on slides" and "says nothing" rules, then the
   organisation check ([RFD 5](0005-decision-models.md)). A card too
   long is split into two or three atomic cards. Others are repaired with the full list of
   problems, at most twice. What still fails is dropped and listed with its reason.
7. **End.** Identical questions are dropped by code, against every card of the course so far.
   An existing card is never the one dropped. No rewriting pass.
8. **Save.** Steps 1 to 4 run over all lectures of the build, since the plan needs every map.
   Steps 5 to 7 then run one lecture after the other, and a lecture is saved as soon as it is
   through, with `course.json` last. A stopped run keeps the lectures it finished; building
   again maps, plans and pays only for the rest.

**Seeing the course as a whole** means no repeats across lectures and one vocabulary: a
concept from an earlier lecture keeps its id and name. In code it gets exactly one more card,
whatever the goal ([#133](https://github.com/stegra05/lectern/issues/133)).

## Why

Measured against the reference deck on 2026-11-15 (636 notes):

- **Reading slide by slide** held 279 notes in its facts, the old one-call-per-lecture map with
  a second reading 253. A first prompt that split every list into one fact per item held only
  244, because no card could then ask "name the three".
- **The worth score**: at 372 cards, the top-scored facts kept 164 of 192 covered notes, map
  order 133, random 129.
- **Sharing cards over the course**: a budget per lecture gave one lecture 173 cards for 140
  facts and cut 63 of 107 facts in another, exactly where the reference deck is densest.

## Given up

- **Text only, pictures only for low-text slides.** Many examined facts sit in figures.
- **Ranking by map order, or the first N facts per concept.** 127 notes against 299.
- **A per-lecture card budget.** See above.
- **Kind of slide, look-alike cards and the copy check.** Removed with the other checks that
  only flagged ([RFD 5](0005-decision-models.md)).

## Open

- Coverage at the fact level is the gap: [#108](https://github.com/stegra05/lectern/issues/108).
- Facts only in pictures: [#106](https://github.com/stegra05/lectern/issues/106).
- Near-identical facts, too many lists and contrasts: [#110](https://github.com/stegra05/lectern/issues/110).
- Defects the gate lets through: [#136](https://github.com/stegra05/lectern/issues/136).
- Cloze is never planned: [#131](https://github.com/stegra05/lectern/issues/131).
