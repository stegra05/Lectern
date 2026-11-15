# RFD 12 · Feedback through fixed actions, no free text

|           |                                                  |
| --------- | ------------------------------------------------ |
| **State** | decided, not built (expansion 1, v3.1)           |
| **Date**  | 2026-11-13                                       |

> **In one breath.** The student changes the deck by pressing closed actions on the result,
> sees the effect as a number first, and only what changed is rebuilt.

## Decision

- **On a lecture**: more cards, fewer cards, skip a part.
- **On a concept**: "I know this" (one card, last in the order), "not needed" (no cards),
  "go deeper".
- **On a decision**: undo it, for example include the guest lecture after all.
- **On a card**: "too easy", "not relevant", "wrong", next to edit and remove.

The app shows the effect before applying it ("14 fewer cards in 09 Growth") and rebuilds only
what changed. Each change appears in the decisions as something the student asked for. It is
stored with the course, so later lectures inherit it. Before sending, changes are free; after
sending, the app never rewrites delivered cards on its own.

Marking a concept as known here is the same gesture as the quiz's map marking, so the quiz
shrinks to the multiple-choice check ([#127](https://github.com/stegra05/lectern/issues/127)).

## Why

Closed actions are operations code can apply and test. Free text would hand the decision back
to the model ([RFD 2](0002-code-decides.md)). And a student who has not learned the course
yet cannot judge relevance, so no action asks them to.

## Open

- The final set of actions, and building it: [#116](https://github.com/stegra05/lectern/issues/116).
