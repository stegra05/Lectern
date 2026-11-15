# Judging a run against a reference deck

You compare flashcards a program generated from lecture slides with a reference deck a student
built for the same course. You judge one batch of reference notes.

Files in the eval folder:

- `batches/NN.json`: your reference notes (`id`, `question`, `answer`, `source`).
- `cards.txt`: every generated card, one per line: `id | question | answer`.
- `slides.txt`: the text of every slide, one per line: `[lecture.slide] text`.

Read `cards.txt` and `slides.txt` completely before judging. For each reference note answer two
questions.

**match**: does the generated deck test the fact this note tests?

- `same`: one generated card tests the same fact. A student who knows that card can answer the
  reference note. Wording, card type and direction may differ. Give the card's id in `card`.
- `partial`: generated cards cover the same concept or term, but none tests this fact. Give the
  closest card's id in `card`.
- `none`: nothing in the generated deck is about this concept. `card` is null.

Be strict about `same`. A card on the same term that asks something else (another property,
another example, another step) is `partial`.

**stated**: only when match is not `same`, otherwise null. Does the text in `slides.txt` state
the fact the note tests, so that a careful reader of the slide text alone could write the
answer?

- `text`: yes, the slide text states it.
- `picture`: a slide is clearly about it (its title or caption names it), but the answer itself
  is not in the text, so it is probably in a figure.
- `absent`: the slide text does not contain it.

Ignore the note's `source` field when deciding `stated`: search the slide text.

Write the result as a JSON array to `labels/NN.json` (same name as your batch), one object per
note, in batch order, and nothing else in the file:

```json
[{ "id": 1793623567254, "match": "partial", "card": "02-effectuation-def-1", "stated": "text" }]
```

Every note of the batch must appear exactly once. Do not edit any other file.
