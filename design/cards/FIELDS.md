# Card field contract

Both note types read exactly these fields through the same four templates in
`packages/engine/anki/`. The design, Native (`style-native.css`), is a stylesheet and nothing else
([RFD 10](../../docs/rfd/0010-card-designs.md)). The limits below are the hard limits of
[RFD 9](../../docs/rfd/0009-cards-in-anki.md) plus the ones the templates need.

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
| Typed | Always empty. Kept so typed answers need no note type upgrade later | Code | See "Typed" |
| Lecture | The lecture number as shown on the map. Also becomes the root class `lec-<Lecture>` (`lec-02`), so a design can colour the card by lecture | Code | Two digits: `02` |
| Topic | The lecture's name | Code | At most 32 characters: `Effectuation` |
| Source | Where the card comes from, as a reader would cite it | Code | `Lecture 2, slide 14`. Also `Script, page 12` or `Exam WS24, question 3` |
| Asked | How many past exam papers asked this question | Code, for past exam cards | `3x`, or empty. Empty means "core" |
| Part | The exam part that asked it | Code | Always empty: the exam part is not inferred |
| Extra | Context after the answer | Model | At most 40 words. Inline maths at most 30 TeX characters; anything longer is written as display maths `\[ \]` |
| Excerpt | A short quote from the source slide | Code, from the slide text | At most 30 words, plain text. The design shows two lines until the slide is opened |
| Slide | The rendered source slide | Code | `<img src="l02-s14.png">`, built from the card's lecture and slide. Anki receives the file as `lectern-<course>-l02-s14.png`, lowercase, in `collection.media` |
| Diagram | The slide image | Code | The same `<img>` as Slide. Only in the diagram role, where it is the figure |
| Key | The concept as plain text | Code | Never rendered. Sort field, search handle and the stable identity of the concept |

## Lectern Cloze v3

Same as Q&A, with `Text` in place of Front, Back, Slots and Code.

| Field | Holds | Filled by | Limits |
|---|---|---|---|
| Text | The sentence or list with deletions `{{c1::...}}` | Model, checked by code | At most 5 deletions, one item each, at most 8 words each. No hints (`{{c1::x::hint}}`): the design hides Anki's `[...]` placeholder, and a hint would be hidden with it. A cloze list is a lead-in plus `<ul>` with one deletion per `<li>` |
| Role | `cloze` or `cloze-list` | Code | |
| Typed | Always empty | Code | As in Q&A |
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

## Decisions

- **Slots is written by code from the role**, never by the model, so the front can show the
  labels and the model cannot invent them.
- **Code is its own field.** A separate field keeps the 20-word limit on Front checkable and keeps
  code out of prose reflow.
- **Weight is two fields, Asked and Part.** The template writes the copy (`asked 6×, multiple
  choice` or `core`) and switches the highlight with `{{#Asked}}`, so the look never depends on a
  string the model or a translation could change. Asked is filled for past exam cards
  (`3x`), and Part is always empty.
- **Topic is two fields, Lecture and Topic.** The number is set like the map's lecture number and
  the name like the map's region name. Source stays a free citation because scripts and past
  exams are cited differently.
- **The key term is `<mark>`**, not `<b>`. In the app's identity highlighter yellow means "this
  matters", and `<b>` stays free for ordinary emphasis.
- **Lists are always `<ul>`.** Numbering (name two, chain) is the design's job, done with CSS
  counters, so the field never carries presentation.
- **The diagram role is a slide image.** The front is one sentence, the slide image goes into
  Diagram. Lectern draws no diagrams.

## Typed

`Typed` is in both note types and always empty, so the templates have no typing box. The field
stays so that bringing typed answers back needs no note type upgrade
([RFD 9](../../docs/rfd/0009-cards-in-anki.md), [#128](https://github.com/stegra05/lectern/issues/128)).
