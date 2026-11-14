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

## How to judge it

The fair test is the same decks built with `--preset concept-draft` next to the placeholder
run. One deck costs about 1 cent, all eleven about 17 cents on `gpt-6-luna`. That is a paid
run, so it needs your yes. I would run all eleven, then compare card types, the share of
administration cards and a sample of cards side by side with your deck.
