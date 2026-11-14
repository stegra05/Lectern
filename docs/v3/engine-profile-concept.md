# Profile for concept courses: draft for review

Written 2026-11-14 for Steffen. Status: **draft, not approved**. It is in the engine as the
preset `concept-draft` (`packages/engine/src/presets.ts`) and is used only when a build names it
(`--preset concept-draft`). Every course still gets the placeholder by default.

Source: the Entrepreneurship study kit, its `STYLE.md` and its 636 vetted cards.

## What the reference deck does that the first run did not

Card types by share. The reference deck was sorted into types by a small model, which said it
had to guess on more than 30 cards, so read these as rough.

| Card type | Reference deck (636) | First real run, placeholder (596) |
|---|---|---|
| reverse (description to term) | 22% | 13% |
| case | 21% | 12% |
| definition | 17% | 29% |
| why, when, what follows | 13% | 0% |
| name two | 6% | 0% |
| contrast | 6% | 18% |
| list to recite | 5% | 23% |
| chain, diagram, cloze sentence | 4% | 5% |
| none of these | 6% | 0% |

Three more facts about the reference deck: 69% of its questions start with a context prefix
("Knight (1921):", "Greiner:"), 35% of its cards carry an `extra`, and its answers lead with the
key term (definition answers average 12 words, reverse answers 7).

So the first run wrote far too many lists and contrasts, too few term and case cards, no "why"
cards at all, and many definitions that restate the question.

## The draft

**Rules for the map** (what counts as a concept and a fact):

1. Only what can be examined is a concept. The organisation of the course is never one: the
   lecturer, dates, grading, assignments, the agenda, a recap of the last session, reading
   lists, instructions for a class exercise.
2. Give each idea several angles as separate facts: what it is, why or when it holds, what
   follows from it, the course example, how it differs from its neighbour.
3. A list fact is a named set the exam asks to recite, such as "the five Cs of lending". The
   bullet points of a slide are not a list fact: take what each bullet teaches as its own fact.
4. A case fact names a company, a person or a study from the lecture and says what it shows.
   Biography and trivia are not facts.

**Rules for the cards**, taken from `STYLE.md`:

1. Lead with the answer: the key term comes first, marked. Never restate the question.
2. One fact per answer, answerable in about ten seconds. Aim for about 12 words.
3. Exactly one defensible answer. A context prefix such as "Greiner:" when it rules out a rival
   answer from another framework.
4. Never a yes/no or an either/or question, and no wording that gives the answer away.
5. A case card names the case in the question.
6. A contrast compares both sides on one dimension, in the same wording.
7. The example, the mechanism or the source goes to extra. Extra is never tested.
8. Key terms exactly as on the slides; the sentence around them reworded.
9. In the language of the slides.

**Example cards**, one per card type, all from the reference deck:

| Card type | Question | Answer |
|---|---|---|
| definition | Sarasvathy: what is causation? | Start from a ==given goal== and select the means to reach it. |
| reverse | Greiner: which phase resolves the crisis of autonomy? | delegation |
| case | Alex Krapp: which big clients did soul-surf win? | BMW and MAN |
| contrast | Causation versus effectuation: how does each handle risk? | Causation: ==expected return==, the best risk-adjusted opportunity. Effectuation: ==affordable loss==, never more than you can afford to lose |
| chain | Lean iteration: which step follows the theory? | Hypothesis |
| name two | Which two exit routes are the most common? | trade sales; buyouts |
| why | Software: why does copyright give it only weak protection? | It protects ==the code, not the idea==. |
| list | Five Cs of lending: | character, capacity, capital, collateral, conditions |
| cloze sentence | Market development can target a new ... market, a new ... market, or a new ... | geographical; demographic; product use |

One of these is adapted to fit its form: the "name two" answer was one phrase in the deck
("Trade sales and buyouts, both changing ownership").

**Mix of card types.** A definition fact becomes a definition card, the next one of the same
concept a reverse card. A cause becomes a "why" card, a list of exactly two a "name two" card,
a longer list a list to recite. Contrast, sequence, case and diagram facts become their own
card type. Beyond that the draft changes the mix through the map rules (fewer lists, more
angles).

## Decided by Steffen on 2026-11-14

1. **"Why" cards**: a ninth kind of fact, `cause`, is added. It becomes a "why" card.
2. **The shape of a "why" answer**: one sentence, a second step allowed. The field contract
   (`FIELDS.md`) still describes two bullets and should follow.
3. **"Name two" cards**: the map counts the items of a list fact; a list of two becomes "name
   two".
4. **A run of all eleven decks with this draft** is approved.

Still open:

- **Course administration.** Rule 1 of the map is in this draft. The second guard is the slide
  label, which only flags until it is calibrated. Its question now describes each kind; in the
  first run it had labelled only 2 of 356 slides as agenda or recap.
- **Approval** of the draft itself, after the comparison run.

## The comparison run

All eleven decks again, goal top grade, `gpt-6-luna`, with this draft (`--preset concept-draft`)
and the three decisions above. Course folder: `courses/entrepreneurship-concept-draft` in the
shared notes folder. 18.6 cents, 17.5 minutes. A first attempt died on a dropped connection and
saved nothing; the adapter now retries six times.

| | Reference deck | Placeholder run | Draft run |
|---|---|---|---|
| Cards | 636 | 596 | 554 |
| definition | 17% | 29% | 28% |
| reverse | 22% | 13% | 14% |
| case | 21% | 12% | 10% |
| why | 13% | 0% | 11% |
| name two | 6% | 0% | 0% (1 card) |
| contrast | 6% | 18% | 17% |
| list to recite | 5% | 23% | 16% |
| Concepts that look like course administration | | 43, with 71 cards | 6, with 8 cards |
| Slides labelled title, agenda, recap or reading list | | 7 | 70 |
| Slides left out | | 23 | 117 |
| Concepts that recur across lectures | | 39 | 17 |
| Dropped cards | | 5 | 8 |
| Flagged cards | | 31 | 24 |
| Hard limit violations | | 0 | 0 |

"Looks like course administration" is a search for words such as course, instructor, session,
agenda, exercise or exam in the concept name. The six left in the draft run are content: they
are the question types of a lecture on metacognition ("Comprehension questions").

**What the draft fixed.** Course administration is gone from the cards: no lecturer, no
course outline, no exercise instructions. "Why" cards exist and read like yours ("Why can an
investor's high-profile reputation become self-fulfilling?"). The reworded slide question
labels ten times as many slides, which also explains why recurring concepts halved: the
administration concepts were the ones that recurred.

**What it did not fix.**

- Definitions still restate the question ("Cognitive adaptability describes how dynamic
  entrepreneurs are") although the rule says never to. The cheap model does not follow that
  rule from text alone.
- One concept often gets two or three cards that ask nearly the same thing, because the map
  states near-identical facts. The "same card" check flags only a few of them.
- Lists and contrasts are still two to three times as frequent as in your deck, term and case
  cards about half as frequent. "Name two" barely appears: the map marked only four lists as
  having two items.
- Lecture 04 (96 slides) lost 52 slides and has 46 cards, against 81 with the placeholder. Many
  of its slides are pictures. Whether that is a loss or a gain needs a look at the slides.

**My read.** Use the draft as the working preset for concept courses: it removes the largest
defect and costs nothing extra. It is not yet at the level of your deck. The next gains are
not in more rules for the model but in code: a check that an answer does not repeat its
question, merging near-identical facts before cards are planned, and a cap on lists and
contrasts per concept. Then the blind comparison against your deck.

