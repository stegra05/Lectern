# RFD 8 · Past exams become cards, not weights

|           |                                                       |
| --------- | ----------------------------------------------------- |
| **State** | decided                                               |
| **Date**  | 2026-11-15, second course 2026-11-17                  |
| **Code**  | `packages/engine/src/exams.ts`, `build.ts` (`addExamAnswers`) |

> **In one breath.** Exams repeat themselves, so the questions of old papers are turned into
> cards first, answered from the slides where possible.

## Decision

When a course folder has `exams/` (in the app: "Past exams" in the course setup, the `add` command with `to: 'exams'`, or a file the `add` command sorted as a past exam), each new paper is read into its questions. Questions that
ask for the same answer form a family, placed in a lecture and a concept. One call per family
writes the answer as a fact and says whether the slides hold it; if not, the model answers
from what it knows and the card's source says so. Exam facts go first in the plan, the most
asked first, and the card shows how often it was asked.

## Why

On Entrepreneurship (18 older papers in, the 4 newest held out, 3 cents):

- **As weights on slide facts, past exams change nothing.** 89 of the 111 facts the older
  questions hit were already among the worth score's picks.
- **As questions, they are the lever.** 47 of the 52 held-out questions have a near-verbatim
  twin in an older paper.

| Selection of 641 facts               | Reference notes | Held-out questions |
| ------------------------------------ | --------------- | ------------------ |
| Map order                            | 127             | 9 of 52            |
| Worth score                          | 299             | 19 of 52           |
| Exam facts first, then worth         | 303             | 20 of 52           |
| All 1,272 facts                      | 355             | 20 of 52           |

**The full run** (2026-11-15, on Steffen's "Model may fill gaps"): the 11 decks plus the 18
older papers, the 4 newest held back. 220 questions became 143 families; the slides answer 94,
the model 49. 633 cards, 136 of them exam cards, 54.5 cents against an estimate of 72, 33
minutes.

|                                                    | Slides only      | With past exams  |
| -------------------------------------------------- | ---------------- | ---------------- |
| Questions of the 4 held-back papers a card answers | 19 of 52         | **34 of 52**     |
| Reference notes with a card on the same fact       | 204 of 636 (32%) | **246 (39%)**    |
| Notes asked 9 times or more                        | 74 of 224 (33%)  | 96 (43%)         |

The held-back questions are the honest measure, because the engine never saw those papers. The
note figure is partly circular: the reference deck was itself chosen with all 22 papers.
Questions asked only once still pay: 97 of the 136 exam cards.

**A second course** (2026-11-17, Grundlagen Datenbanken, `gpt-6-luna`, goal good): 21
lectures with 1,538 slides and 6 past papers made 1,616 cards, 40 dropped, for 1.79 dollars
against an estimate of 2.13, in 21 minutes. 109 cards come from past exam questions, 28 of them
answered off the slides. Of those 28, about 17 do not stand alone: the question is a task on the
paper's own scenario (an ER diagram, a schedule, a query to debug) and the card keeps the task
without the scenario, and on some the answer itself says it cannot be given. About 11 are
sound. The 81 exam cards answered from the slides were not read. This is open as
[#342](https://github.com/stegra05/Lectern/issues/342).

## Given up

- **Exam weight as a multiplier** on facts.

## Known limits

- Papers count for the lectures built with them. Adding papers to a course whose lectures are
  built changes no card already made.
- Model-written answers looked right in a sample of ten, none checked against the readings.
- Run on two courses. On Grundlagen Datenbanken about 17 of 28 cards answered off the slides do
  not stand alone ([#342](https://github.com/stegra05/Lectern/issues/342)); the held-out
  questions of that course were not measured ([#111](https://github.com/stegra05/lectern/issues/111)).
- Exam format and exam part (`Part`) are not inferred.
