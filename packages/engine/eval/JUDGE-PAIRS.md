# Judging whether a card holds a knowledge point

A program made flashcards from the lecture slides of a course. An exam the program never saw
was read into knowledge points: what a student must know to earn its marks. You decide, one
pair at a time, whether a card holds a point.

You are given one batch file, `pairs/NN.json`. Each entry has:

- `point`: the id of the point,
- `asks`: the exam question the point belongs to,
- `knows`: the point, what the student must know,
- `cards`: up to eight cards that share words with the point, each with `id`, `question` and
  `answer`.

For every card of every entry give one verdict:

- `same`: a student who has learned this card, front and back, knows what `knows` states,
  well enough to earn its marks on the question in `asks`. Wording, direction and card type
  may differ. The card has to state it. A card from which a clever student could work it out
  does not count, and neither does a card that names the term and asks something else.
- `partial`: the card is about the same concept or term and does not give this point.
- `no`: the card is about something else.

Judge each pair on its own: one card, one point. Two cards that hold the point between them
are two `partial`. Be strict about `same`. A point that lists several things is held only by a
card that gives all of them.

When no card of an entry is `same`, search `cards.txt` in the same folder (one card per line,
`id | question | answer`) once for that entry: one `grep -i -E` with the point's key terms and
their synonyms joined by `|`. A card you find there that holds the point is one more pair with
the verdict `same`. Do not add pairs for other verdicts, and never read `cards.txt` whole.

Work in few steps: read the batch once, decide, search where needed, write the file once. Do
not check your file with a script and do not read it back; the program that takes it in checks
that it is complete.

Write the result as a JSON array to `verdicts/NN.json` (the name of your batch) and nothing
else in the file:

```json
[{ "point": "1_Exam Summer26/1/1", "card": "03-value-proposition-definition-1", "verdict": "same" }]
```

Every card of every entry must appear exactly once with its entry's point. Do not edit any
other file.
