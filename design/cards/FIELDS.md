# Card field contract

Both skins read exactly these fields through the same four templates in `packages/engine/anki/`. A skin is a
stylesheet and nothing else. Read `docs/brief.md` ("Card system") and `design/samples.md`
first; the limits below repeat the brief's hard limits and add the ones the templates need.

Two note types, installed by Lectern and owned by Lectern:

- **Lectern Q&A**: `front.html` and `back.html`, one card per note.
- **Lectern Cloze v3**: `cloze-front.html` and `cloze-back.html`, one card per deletion. Not
  "Lectern Cloze": Lectern 2 installed a note type of that name with other fields, and a
  student who used it still has it.

Sort field in both: `Key`. Field order is the order of the tables.

## Lectern Q&A

| Field | Holds | Filled by | Limits |
|---|---|---|---|
| Front | The question. Plain text, inline MathJax `\( \)`, `<sub>`, `<sup>` | Model | At most 20 words. No yes/no question. No code, no list |
| Back | The answer. A plain sentence, or `<ul>` with one `<li>` per slot. The key term wrapped in `<mark>` | Model, wrapped by code | At most 25 words, at most 2 `<li>`. Display maths `\[ \]` only in the formula role |
| Role | One token from the closed role set (below) | Code | Lowercase, hyphenated. Becomes the class `role-<Role>` |
| Slots | Slot labels for the front: one `<span>` per slot, an empty `<span></span>` for a gap the student fills | Code, from the role's slot template | Only for roles that name their slots (contrast, chain, code). At most 6 spans, each at most 4 words |
| Code | A code listing shown under the question | Code, from the source | Plain text, HTML-escaped, real newlines, at most 16 lines of at most 60 characters |
| Typed | Empty: the student answers in their head. Set: the student types, and this is the text Anki compares against | Code, never the model | See "Typed answers". At most 3 words and 30 characters |
| Lecture | The lecture number as shown on the map. Also becomes the root class `lec-<Lecture>` (`lec-02`), so a skin can colour the card by lecture | Code | Two digits: `02` |
| Topic | The lecture's name | Code | At most 32 characters: `Effectuation` |
| Source | Where the card comes from, as a reader would cite it | Code | `Lecture 2, slide 14`. Also `Script, page 12` or `Exam WS24, question 3` |
| Asked | How many past exams asked this concept | Code (exam weight counting) | An integer of at least 1, or empty. Empty means "core" |
| Part | The exam part that asked it | Code | From the exam-format profile: `multiple choice`, `short answer`, `essay`, `proof question`, `calculation`. Only with Asked |
| Extra | Context after the answer | Model | At most 40 words. Inline maths at most 30 TeX characters; anything longer is written as display maths `\[ \]` |
| Excerpt | A short quote from the source slide | Code, from the slide text | At most 30 words, plain text. The skins show two lines until the slide is opened |
| Slide | The rendered source slide | Code | `<img src="l02-s14.png">` in the card file. Anki receives the file as `lectern-<course>-l02-s14.png`, lowercase, in `collection.media` |
| Diagram | The slide image | Code | The same `<img>` as Slide. Only in the diagram role |
| Key | The concept as plain text | Code | Never rendered. Sort field, search handle and the stable identity of the concept |

## Lectern Cloze v3

Same as Q&A, with `Text` in place of Front, Back, Slots and Code.

| Field | Holds | Filled by | Limits |
|---|---|---|---|
| Text | The sentence or list with deletions `{{c1::...}}` | Model, checked by code | At most 5 deletions, one item each, at most 8 words each. No hints (`{{c1::x::hint}}`): the skins hide Anki's `[...]` placeholder, and a hint would be hidden with it. A cloze list is a lead-in plus `<ul>` with one deletion per `<li>` |
| Role | `cloze` or `cloze-list` | Code | |
| Typed | Empty, or `on` | Code | `on` only when every deletion of the note passes the typing rule. Anki itself extracts the expected text for each card |
| Lecture, Topic, Source, Asked, Part, Extra, Excerpt, Slide, Diagram, Key | As in Q&A | | |

## Roles and what they expect

| Role | Back | Slots |
|---|---|---|
| definition | One sentence | none |
| reverse | One term | none |
| contrast | `<ul>` with one item per side | one label per side |
| chain | `<ul>` with one item per gap | the given steps, then one empty span per gap |
| name-two | `<ul>` with two items | none |
| why | `<ul>` with two reasoning steps | none |
| code | `<ul>` with one item per question part | one label per part |
| case | One term | none |
| formula | `\[ \]` display maths, then one sentence with the condition | none |
| diagram | One sentence; the slide image goes into Diagram | none |
| cloze, cloze-list | (Cloze note type) | none |

A role that expects a list still renders when Back is a sentence: the answer becomes one slot
under the labels. The validator should still reject it, because the front promised a shape.
An unknown role renders as a single slot with the cue "Your answer".

## Decisions where the explorations diverged

- **Slots stays** (from Structure). Lamp put the side names inside Back as `<li><b>Side</b> value</li>`.
  That makes the front unable to show the labels, which is the whole point of answer-shaped
  slots, and it lets the model invent the labels. Slots is written by code from the role.
- **Code is its own field** (from Structure). Lamp put the listing inside Front. A separate field
  keeps the 20-word limit on Front checkable and keeps code out of prose reflow.
- **Weight is two fields, Asked and Part.** Lamp matched the text prefix `asked` with an
  attribute selector; Structure printed one string. The template now writes the copy
  (`asked 6×, multiple choice` or `core`) and switches the highlight with `{{#Asked}}`, so the
  look never depends on a string the model or a translation could change.
- **Topic is two fields, Lecture and Topic.** The number is set like the map's lecture number
  and the name like the map's region name. Source stays a free citation because scripts and
  past exams are cited differently.
- **The key term is `<mark>`** (from Lamp), not `<b>`. In the app's identity highlighter yellow
  means "this matters", and `<b>` stays free for ordinary emphasis.
- **Lists are always `<ul>`.** Numbering (name two, chain) is the skin's job, done with CSS
  counters, so the field never carries presentation.

## Typed answers

**Who decides.** Code, per note, never the model. A note gets typing when all of these hold:

1. The role is `reverse`, `case`, `cloze` or `cloze-list`.
2. The expected text is at most 3 words and at most 30 characters.
3. It holds no maths, no code, no `<sub>` or `<sup>`, no list and no line break.
4. For cloze notes: every deletion of the note passes 2 and 3, because the switch is per note.
5. For Q&A notes: Back is the term and nothing more (ignoring `<mark>` and a final full stop),
   so the comparison can replace the answer without losing anything.

Formulas, diagrams, definitions, explanations and two-part answers never get typing.

**What Typed holds.** For Q&A: the term in the casing the concept map stores for the concept
(`bird in hand`, `Bellman-Ford`). Anki compares case-sensitively, and a capital that only comes
from starting a sentence would mark a correct answer red. For cloze: the word `on`.

**How one note switches.** The templates wrap the typing box in a conditional on the field:

```
{{#Typed}}<div class="lc-type">{{type:Typed}}</div>{{/Typed}}
{{#Typed}}<div class="lc-type">{{type:cloze:Text}}</div>{{/Typed}}
```

Empty field, no box: the card is a normal card. Filled field, box. Switching is an edit of one
field on the same note, so the card keeps its id and its review history. Rejected alternatives:
a second card template would create a second card with its own schedule (and a cloze note type
cannot have a second template), and a separate note type would double the styling that Lectern
has to keep upgraded and would lose the card's history on a note type change.
