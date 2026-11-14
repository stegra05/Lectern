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
| why | Software: why does copyright give it only weak protection? | Copyright protects ==the code, not the idea==. So a rival may build the same idea in new code. |
| list | Five Cs of lending: | character, capacity, capital, collateral, conditions |
| cloze sentence | Market development can target a new ... market, a new ... market, or a new ... | geographical; demographic; product use |

Two of these are adapted to fit the forms: the "name two" answer was one phrase in the deck
("Trade sales and buyouts, both changing ownership"), and the "why" answer was one sentence
("It protects the code, not the idea") where the form asks for two steps.

**Mix of card types.** Unchanged from the placeholder for now: a definition fact becomes a
definition card, the next one of the same concept a reverse card; contrast, list, sequence,
case and diagram facts become their own card type. The draft changes the mix through the map
rules instead (fewer lists, more angles), because the plan can only choose among the kinds of
fact that exist.

## What the draft cannot do, and what I need from you

1. **"Why" cards.** 13% of your deck asks why, when or what follows. The closed list of fact
   kinds you decided (definition, contrast, list, sequence, formula, code, case, diagram) has
   no kind for a cause or a consequence, so the plan can never choose a "why" card.
   - Option A, my lean: add a ninth kind, `cause`. One more label for the decision model.
   - Option B: keep eight kinds. "Why" questions then only appear when the model happens to
     word a definition card that way, and code cannot count or steer them.
2. **The shape of a "why" answer.** The field contract (`FIELDS.md`) gives a "why" card two
   reasoning steps as two bullets. Your "why" cards are almost all one sentence.
   - Option A, my lean: one sentence, as in your deck, with two steps allowed.
   - Option B: keep two steps as the contract says.
3. **"Name two" cards.** 6% of your deck. Code cannot see from a fact's text whether it names
   exactly two items. Option A, my lean: the map marks how many items a list fact has, and a
   list of two becomes "name two". Option B: leave them to the list card.
4. **Course administration.** Rule 1 of the map is in this draft. A second guard is the slide
   label (title, agenda, recap, reading list, content), which only flags until it is
   calibrated. In the first run it labelled 2 of 356 slides as agenda or recap, so it needs
   better wording before calibration is worth it. I would do both; say if you want only one.
5. **Approval.** This is a draft from your own rules and cards. Change anything.

## How to judge it

The fair test is the same decks built with `--preset concept-draft` next to the placeholder
run. One deck costs about 1 cent, all eleven about 17 cents on `gpt-6-luna`. That is a paid
run, so it needs your yes. I would run all eleven, then compare card types, the share of
administration cards and a sample of cards side by side with your deck.
