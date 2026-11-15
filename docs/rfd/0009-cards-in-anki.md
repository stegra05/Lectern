# RFD 9 · Cards in Anki: two note types, sent once, never rewritten

|              |                                                                          |
| ------------ | ------------------------------------------------------------------------ |
| **State**    | decided                                                                  |
| **Date**     | 2026-11-13 (brief, field contract), 2026-11-14 (first real send)         |
| **Code**     | `packages/engine/src/deliver.ts`, `cards/`, `packages/engine/anki/`      |
| **Contract** | [`design/cards/FIELDS.md`](../../design/cards/FIELDS.md)                  |

> **In one breath.** Lectern owns two note types with one field contract, sends each card once
> through AnkiConnect, and never touches a note in Anki again unless the student asks.

## Decision

- **Hard limits, enforced by code.** Front at most 20 words, answer at most 25 words and at
  most 2 bullets, no yes/no questions. Cloze: one item per deletion, at most five, at most 8
  words each.
- **A closed set of roles**, each with a slot template: definition, reverse, contrast, chain,
  name two, why, code, case, formula, diagram, cloze, cloze list. The role is a class on the
  card, so the design adapts without JavaScript.
- **Two note types**, `Lectern Q&A` and `Lectern Cloze v3`, reading the same fields through four
  shared templates. A design is a stylesheet and nothing else ([RFD 10](0010-card-designs.md)).
- **Typed answers are decided by code**, never the model: reverse, case and cloze only, at most
  3 words and 30 characters, no maths or code. Switching is one field (`Typed`), so a card keeps
  its id and review history.
- **Delivery through AnkiConnect**, the only path. One root deck per course, a subdeck per
  lecture. If the course name is taken, the deck is called "<course> (Lectern)". Tags
  `<course>::lecture::NN`, `<course>::role::<role>`, and `<course>::own` on the student's own
  cards. Media names are lowercase, because phones keep lowercase names.
- **Sent once.** `anki.json` records what is in Anki. A second send adds only new cards. After
  adding, the send checks every note again and retries up to three times.
- **Edits are the student's.** Changing, removing and writing cards works in the app and in
  Anki; Lectern never rewrites a delivered note on its own.

## Why

The first real send (2026-11-14, Anki 26.9.4): 94 cards with 38 slide pictures in 10.9
seconds, and 2 of 94 notes vanished. Anki's undo had removed notes the student had just
answered. Hence the check after adding. A second send said "Every card of this course is
already in Anki."

Typing is per note, not a second card template: a second template would create a second card
with its own schedule, and a cloze note type cannot have one.

## Known limits

- `FIELDS.md` names `Key` as the sort field, but AnkiConnect cannot set it, so Anki sorts by
  the first field.
- An undo after the final check still removes Lectern's newest note unnoticed.
- A card that passed when built can be refused on a later edit, because the validator grew.

## Open

- From inside the app, against a real Anki: [#112](https://github.com/stegra05/lectern/issues/112).
- Typing as a course setting, and the strict comparison: [#128](https://github.com/stegra05/lectern/issues/128).
- Lectern's own preset: [#117](https://github.com/stegra05/lectern/issues/117).
