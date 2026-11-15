# Which facts answer a note

The facts a program read from lecture slides, judged once so that any selection of them can be
scored later without judging again.

Files in the eval folder:

- `batches/NN.json`: your items (`id`, `question`, `answer`, `source`). `answer` may be empty
  when the item is an exam question without a model answer.
- `facts.txt`: every extracted fact, one per line: `id | concept | fact`. It comes from
  `read-slides.ts`; `JUDGE.md` is for the cards of a build.

Read `facts.txt` completely before judging. For each item:

- `match`: `same` when at least one fact, or two or three facts together, give what a student
  needs to answer the item. `partial` when facts are about the same concept or term but do not
  give the answer. `none` otherwise.
- `cards`: for `same`, the ids of every fact that answers the item on its own, plus, when it
  takes several facts together, those facts. For `partial`, the closest fact. For `none`, empty.

Be strict about `same`. A note that asks for a list of several items is `same` only when the
listed facts name all of them.

Write the result as a JSON array to `labels/NN.json` (same name as your batch), one object per
item, in batch order, and nothing else in the file:

```json
[{ "id": 1793623567254, "match": "same", "cards": ["L04-17", "L04-18"], "stated": null }]
```

Every item of the batch must appear exactly once. Do not edit any other file.
