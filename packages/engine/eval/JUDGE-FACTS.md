# Judging extracted facts against a reference deck

The facts a program read from lecture slides, before any card is written. This measures the
reading alone: a fact that is missing here can never become a card.

Files in the eval folder:

- `batches/NN.json`: your reference notes (`id`, `question`, `answer`, `source`).
- `facts.txt`: every extracted fact, one per line: `id | concept | fact`. It comes from
  `read-slides.ts`; `JUDGE.md` is for the cards of a build.

Read `facts.txt` completely before judging. For each reference note decide `match`:

- `same`: one fact states what the note tests, so that a student who learned that fact could
  answer the note. Wording may differ. Give the fact's id in `card`.
- `partial`: facts are about the same concept or term, but none states what this note tests.
  Give the closest fact's id in `card`.
- `none`: no fact is about this concept. `card` is null.

Be strict about `same`. A note that asks for a list of several items is `same` only when one
fact names all of them.

Write the result as a JSON array to `labels/NN.json` (same name as your batch), one object per
note, in batch order, and nothing else in the file:

```json
[{ "id": 1793623567254, "match": "same", "card": "S04.7-3", "stated": null }]
```

Every note of the batch must appear exactly once. Do not edit any other file.
