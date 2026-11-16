# Reading a past paper into knowledge points

You turn one past exam paper into the test set of a benchmark. A program makes flashcards from
the lecture slides of this course without ever seeing this paper. Later a judge checks, point
by point, whether its cards hold what the paper asks for. Your points are the truth it is
measured against, so a wrong or vague point costs more than a missing one.

You are given:

- the paper, and its official solution when there is one,
- the text of the course's slides (`slides.txt`, one slide per line as `[lecture.slide] text`),
- when it exists, a student's notes for the course (`notes.json`, question and answer pairs).

Read the paper completely. Search the slides and the notes for each answer; do not read them
from end to end.

For every question a student must answer, in the order of the paper:

- `number`: the number as the paper gives it, such as "3" or "2b". A question with parts that
  carry their own marks is one entry per part. Where the paper lets the student answer only
  some of a set ("answer five of these six", "one of two options"), every question of the set
  is its own entry with its own marks, and the set is listed under `choices`.
- `asks`: the question in one line. A multiple choice question keeps its options. A question
  on a case keeps what a student needs of the case in a few words.
- `marks`: the marks of the question as the paper states them.
- `points`: what a student must know to earn those marks.

A point is one statement of knowledge, written so that it stands alone:

- `knows`: the fact, definition, reason, relation, formula or step, in a full sentence that
  names its subject. "The value proposition is the unique offering a firm promises to its key
  customers." Never "the answer is C", never "see slide 4", never a question.
- `marks`: the marks this point earns. The points of a question add up to its marks. When a
  question lets the student choose ("name three of the five"), write a point for every
  acceptable answer, each with the marks one answer earns; their sum may then exceed the
  question's marks.
- `kind`: `recall` when knowing the statement earns the marks. `apply` when the marks are for
  carrying something out on input the paper gives: a calculation, a query to write, an
  algorithm to run, a concept applied to a case. A question often has both: the concept a
  student must know is a `recall` point, the transfer to the case an `apply` point that says
  what is to be done ("Applies the five forces to the airline case: names at least three
  forces with a fitting observation each").
- `basis`: where you confirmed the point. `solution`: the official solution states it.
  `slides`: the slides state it. `notes`: only the student's notes state it. `own`: nothing
  you were given states it and it rests on what you know.

Rules:

- One fact per point. A point is what one flashcard could hold. Two facts that a student could
  know one without the other are two points, each with its share of the marks: a definition and
  its example, a term and its three types, a benefit and a second benefit. Measured 2026-11-16:
  points that bundled several facts caused most of the disagreement between two judges.
- A list is one point only when the question asks for the list as a whole ("name the five
  forces"). Otherwise every item that earns marks is its own point.
- No padding. Leave out examples, reasons and consequences the marks are not for.
- For a multiple choice question the point is the one fact that selects the right option,
  stated positively. Do not explain why the other options are wrong. When the right option is
  "all of the above", write one point per statement that has to be known. Work the question
  out; do not guess.
- The same fact asked in two questions is written in the same words both times.
- The course's own wording and names win over textbook wording: use the terms of the slides.
- Write in the language of the paper.
- Leave out instructions, the cover page and blank answer space. Read the paper's total from
  its cover or its point table.

Write one JSON file and nothing else, at the path you were told:

```json
{
  "paper": "1_Exam Summer26",
  "total": 60,
  "choices": [{ "questions": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"], "pick": 5 }],
  "questions": [
    {
      "number": "1",
      "asks": "The unique offering a firm promises to its key customers is also called the value A) offering B) promise C) proposition D) provision",
      "marks": 2,
      "points": [
        {
          "knows": "The value proposition is the unique offering a firm promises to its key customers.",
          "marks": 2,
          "kind": "recall",
          "basis": "slides"
        }
      ]
    }
  ]
}
```

`paper` is the file name of the paper without its extension. `choices` is empty when the
student answers everything. The marks of all questions must add up to `total`, counting of
each choice only as many questions as the student answers. Do not edit any other file.
