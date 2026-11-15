# Engine decisions by Steffen

Decided in an interview on 2026-11-14. These override the engine goal where they differ.
More will follow: he wants to give input on how cards are created, after research into v1, v2,
his other projects and other tools. Until that lands, keep the card-writing strategy easy to
change and build the parts that do not depend on it first.

## Decided

1. **Reading slides.** Extract text locally. Send a slide to the model as an image only when
   it has little text, so figures and formula slides are still seen.
2. **Default model.** Decided by a new eval, not now. Paid runs for that eval may use up to
   50 dollars in total without asking each time, **on OpenAI only** (he has credits there).
   So the first real adapter is for OpenAI. Any other paid run still needs his yes.
3. **The goal changes coverage and depth.** Pass: the core concepts, one card each. Good
   grade: every concept, about two angles. Top grade: every concept from several angles, plus
   cases and contrasts.
4. **Language.** Cards are written in the language of the slides. No question is asked.
5. **Failed cards.** A card that still fails the hard limits after retries is dropped and
   listed under what was left out, with its concept and the reason.
6. **Checking cards against slides.** A free rule first. Cards the rule is unsure about go to
   a decision model. The check sits behind its own port: a decision model when the student's
   provider has one, otherwise a small model of the same provider. Steffen says Google and
   OpenAI both offer decision models. Google's `gemini-decision-1` is confirmed (a closed-set
   scoring model: yes or no, choice, rubric, no text output). OpenAI's is not yet verified:
   check before building on it.
7. **Cost.** Show an estimate before the run and enforce a hard cap: stop cleanly when the
   real cost passes a set multiple of the estimate.
8. **Card kinds in the base.** The core set (definition, reverse, contrast, list, chain, name
   two, case, why) plus formula cards, code cards, drawing cards and typed answers.
9. **Drawing cards.** A redrawn diagram is preferred over showing the slide, but only in a
   form that is easy for a model: a structured description from a small set of diagram types
   that code renders. This must be benchmarked before it is trusted. The slide image is the
   fallback.
10. **Card files.** One readable file per lecture, as in his two study kits (YAML), not one
    file per card. Adding a lecture must leave the files of earlier lectures untouched.
11. **Seeing the course as a whole.** In the base this means three things: no repeats across
    lectures, concepts that recur across the course weigh more and get more cards, and one
    vocabulary across all lectures. Explicit links between lectures are not required yet.

## How cards are created

Decided in a second interview on 2026-11-14, after research into Lectern v1 and v2, his
hackathon and other LLM projects, open-source generators and the literature. His principle:
"As much tooling and help for LLMs as possible is good." The model never decides how many
cards exist or what shape they take.

1. **Profile at upload.** The course is classified into kinds of lecture: concept courses
   (business, social science), formula courses (maths, statistics, physics), programming
   courses, fact-heavy courses (medicine, biology, law). A course may blend several kinds,
   weighted. The student sees one line to confirm and can change it. A profile is a preset we
   write by hand: example cards per card type, the mix of card types, and rules. Profiles are
   drafted with a strong model from real lectures and his Entrepreneurship deck, and Steffen
   approves each one before it ships.
2. **Kind of slide.** Each slide is labelled title, agenda, recap, reading list or content.
   Slides that are not content are left out, and the label is the reason shown to the student.
3. **Map.** The model reads a lecture into topics, concepts and testable facts. Two checks
   follow: does each concept really belong to this lecture, judged against the slides, and is
   a concept the same as one from an earlier lecture. The second keeps one vocabulary and
   prevents repeats.
4. **Kind of fact.** Each fact is labelled from a closed list: definition, contrast, list,
   sequence, formula, code, case, diagram. Code then plans the cards: the kind picks the card
   type and the goal decides how many facts get cards.
5. **Fill.** The model writes one card per planned slot through a small form for that card
   type, with the limits built in. It sees the whole lecture while writing (his choice, over a
   smaller context). Key terms appear exactly as on the slides, the sentence around them is
   reworded. Examples come from the profile.
6. **Gate.** Hard limits, then a copy check that flags answers copying long runs of slide
   text, then the slide check (a rule first, a decision model for doubtful cards). One
   candidate per card, repaired on failure with the full list of what was wrong. A card that
   is too long is split into several atomic cards, each gated again. What still fails is
   dropped and listed.
7. **End.** No rewriting review pass. Code finds pairs of cards that look alike across the
   whole course, and a decision model says whether they test the same thing. Duplicates are
   dropped, near twins are flagged.

**Decision models.** Every closed-set judgement above goes to a decision model: kind of
lecture, kind of slide, concept belongs, same concept, kind of fact, supported by slide,
same card. Both providers have one. OpenAI: `POST /v1/decisions` on `gpt-6-luna`, GA since
2026-10-22, up to 400 questions per request, text and images, 0.10 dollars per million input
tokens, cached input cheaper. Google: `gemini-decision-1`, up to 1,000 questions per request,
text, images and PDF, 0.10 dollars per million input tokens. Roughly 2,000 decisions for a
course cost two to three cents. Neither returns explanations, and neither publishes accuracy.

**Calibration.** Because accuracy is unproven, thresholds are set on our own labelled data: a
strong model labels a few hundred examples from his Entrepreneurship course and Steffen
spot-checks about thirty. A check that has not been measured only flags. It does not drop.
A check that a card "tests exactly one thing" was considered and left out for now.

**Lessons the research adds.** v1 and v2 let the model choose the cards and ended with a
rewriting review pass. Their evals showed maps split too finely, a stop rule that accepted a
third of the slides uncovered, and a review doing heavy repair. In his hackathon projects the
reliable pattern was the reverse: the model writes only words, code owns numbers and
decisions, bad output is dropped by a rule and a fallback stands in, and thinking is switched
off for recall-style tasks. One outside report found a model used as a checker missing errors
and "correcting" good cards, so checks drop or flag and never rewrite.

## Test courses

Besides Entrepreneurship (the business course with the reference deck), Steffen chose two more:

- **Grundlagen Datenbanken**: `/Users/stef/Documents/Uni/Semester 3/Grundlagen Datenbanken/`,
  slides in `Vorlesungen/` as `Kapitel1` to `Kapitel21`, German, relational algebra and SQL.
  Tests code cards and German. His own deck for it exists as YAML card sources under
  `/Users/stef/Documents/Uni/anki/AnkiTUM` (course IN0008), which makes a comparison possible,
  and there are 8 past exams. It is large, so a first run may use a few chapters.
- **Operations Research**: `/Users/stef/Documents/Uni/Semester 4/Operations Research/lecture/`,
  about 15 numbered lecture PDFs, English, formula-dense. Tests formula cards. Skip
  `x_all-slides.pdf`, a merged copy of 690 pages.

Read these folders, never write to them. Work on copies in a course folder of your own.

## Decided on the concept profile draft

Steffen's answers on 2026-11-14 to the open points of `engine-profile-concept.md`, given
through the question tool in the engine session:

- **A ninth kind of fact, `cause`**: a reason, a condition or a consequence. It becomes a "why"
  card. His reference deck has about 13% of those and the eight kinds could not plan one.
- **A "why" answer is one sentence, a second step is allowed.** This departs from the field
  contract, which gives a "why" card two bullets; `design/cards/FIELDS.md` still says so.
- **The map counts the items of a list fact.** A list of exactly two becomes a "name two"
  card, a longer one a list to recite.
- **Paid runs.** Only the engine session starts them. He approved one run of all eleven
  Entrepreneurship decks with the draft profile, about 17 cents.

## Decided on 2026-11-15

Steffen's answers in the engine session, after the comparison run of the concept profile:

- **The concept profile is the working preset for concept courses.** It is not the last word:
  definitions that restate their question, near-identical cards and too many lists were still
  open in the comparison run, and code checks for them followed.
- **The slide check and the concept check may be re-measured** with a few cents of paid
  decision calls, to find out whether they work better with the slide or the concept as the
  only input.

## Pending

- Themes across lectures stay out of the base.
