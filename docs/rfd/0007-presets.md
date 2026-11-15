# RFD 7 · One concept preset for every course

|           |                                                                      |
| --------- | -------------------------------------------------------------------- |
| **State** | decided for the concept preset, other kinds later                    |
| **Date**  | 2026-11-14 (draft and decisions), 2026-11-15 (accepted)              |
| **Code**  | `packages/engine/src/presets.ts`                                     |

> **In one breath.** Every course uses the concept preset: hand-written rules, examples and card
> types, built from Steffen's Entrepreneurship deck. The four kinds of course and the classifier
> that picks one return with [#111](https://github.com/stegra05/lectern/issues/111) and
> [#194](https://github.com/stegra05/lectern/issues/194).

## Decision

- **One preset for every course** (`CONCEPT` in `presets.ts`). There is no classifier: three of
  the four kinds mapped to one placeholder, so it decided nothing. The planned kinds are concept
  (business, social science), formula (maths, statistics, physics), programming and fact-heavy
  (medicine, biology, law); a decision model would pick one from the first 6,000 characters and
  the student would confirm it as one line ([#132](https://github.com/stegra05/lectern/issues/132)).
- **A preset is written by hand**: map rules, card rules, one example card per card type, the
  card type per kind of fact. Drafted with a strong model from real lectures and a reference
  deck; Steffen approves each before it ships.
- **The concept preset** is accepted as the working preset. A course that is not a concept
  course gets it too, with no quality statement ([#111](https://github.com/stegra05/lectern/issues/111)).
- **Decided on the draft**: a ninth kind of fact, `cause`, which becomes a "why" card; a "why"
  answer is one sentence, a second step allowed; a list of exactly two becomes "name two".

**Map rules** of the concept preset: only what can be examined is a concept, never the
organisation of the course; several angles per idea as separate facts; a list fact is a named
set the exam asks to recite, not a slide's bullets; a case fact names a company, person or
study and says what it shows.

**Card rules**, from the study kit's `STYLE.md`: lead with the answer and mark the key term;
one fact, about 12 words, ten seconds; one defensible answer, with a context prefix such as
"Greiner:" when it rules out a rival; no yes/no or either/or; a case card names the case; a
contrast compares both sides on one dimension; examples go to extra, which is never tested.

## Why

The first run with the placeholder, against the reference deck (rough shares, sorted by a
small model):

| Card type      | Reference (636) | Placeholder (596) | Concept preset (554) |
| -------------- | --------------- | ----------------- | -------------------- |
| definition     | 17%             | 29%               | 28%                  |
| reverse        | 22%             | 13%               | 14%                  |
| case           | 21%             | 12%               | 10%                  |
| why            | 13%             | 0%                | 11%                  |
| contrast       | 6%              | 18%               | 17%                  |
| list to recite | 5%              | 23%               | 16%                  |

The preset removed course administration from the cards (43 concepts with 71 cards down to
none of substance) and brought "why" cards, at no extra cost (18.6 cents, 17.5 minutes).

What it did not fix: definitions still restate the question, because a cheap model does not
follow that rule from text alone; near-identical cards per concept; lists and contrasts two to
three times too frequent. The next gains are in code, not in more rules
([#110](https://github.com/stegra05/lectern/issues/110)).

## Test courses

Besides Entrepreneurship, Steffen chose Grundlagen Datenbanken (German, SQL, a weak AnkiTUM deck
as reference, 8 past exams) and Operations Research (English, formula-dense; skip
`x_all-slides.pdf`). Paths are in the project memory. Read them, never write to them.
