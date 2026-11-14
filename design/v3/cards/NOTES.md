# Cards: one system, two skins

## The idea

One field contract and one set of four templates; a skin is a stylesheet. Every card shows the
shape of its answer on the front and fills the same shape on the back, names that shape in one
cue line, and carries a print of its source slide at the foot of the back. Structure draws the
answer space as dashed slots on dot grid paper in the survey sheet colours; Lamp draws it as the
blank ruling of an index card and writes the answer on the same lines.

## Files

- `anki/front.html`, `back.html`, `cloze-front.html`, `cloze-back.html`: the shared templates.
- `anki/style-structure.css` with `_StructureSans.woff2` (Atkinson Hyperlegible Next) and
  `_StructureSerif.woff2` (Young Serif, Latin). Both OFL.
- `anki/style-lamp.css` with `_LampSerif.woff2` (Source Serif 4) and `_LampMono.woff2`
  (IBM Plex Mono). Both OFL. The four file names do not collide in `collection.media`.
- `FIELDS.md`: the field contract, the typing rule, the diagram rule.
- `gallery.html`: 17 cards (the twelve samples, typed variants 2t, 10t, 12t, and fallbacks 3x and
  4x where Back is a sentence instead of a list). Switches for skin, light or night, 360 or 600,
  slide open or closed. URL parameters: `?cards=2t,10t&skin=both&mode=both&w=360&slide=open`.
- `build.py` + `gallery.src.html`: rebuild with `uv run --with anki python build.py`.
- `shots/`: the screenshots used to check every card in both skins and both modes.

## How the gallery stays truthful

`build.py` does not imitate Anki's template language. It installs the two note types into a
throwaway collection with the `anki` package (26.09.4 from PyPI), adds every sample as a real
note and takes `card.question()` and `card.answer()`. The typing step is a port of
`typeAnsQuestionFilter` and `typeAnsAnswerFilter` from `aqt/reviewer.py`, and the comparison
markup comes from Anki's backend (`col.compare_answer`, `col.extract_cloze_for_typing`). Each
card is shown in its own iframe with `body.card.cardN`, `nightMode night_mode`, `html.mobile` at
360 px, and the default rules of Anki's `ts/reviewer/reviewer.scss` underneath the skin.

That last part found a bug in both explorations: the reviewer sets `body.nightMode {
background-color: var(--canvas) }`, which outranks `.card { background-color }`. In real Anki
desktop both earlier night modes would have shown Anki's grey canvas instead of their own ground.
Both skins now set the ground on `.card, .card.nightMode`.

## Did one set of templates hold?

Yes, fully. No template differs between the skins. The markup carries two things that only one
skin needs, both harmless to the other:

- `.lc-tab` sits before `.lc-sheet`, because Lamp draws the weight as a divider tab on top of the
  card. Structure sets `.lc-sheet { display: contents }` and lays the tab out as a chip on the
  topic line, dropping below it when both do not fit.
- The cue sits right above the answer space. Lamp first had it in the card head; it now sits
  above the ruled lines, and on the back it turns into Lamp's short amber rule.

## How role adaptation works (no JavaScript)

1. **Role as a class.** `role-{{Role}}` picks the cue text (CSS `content`) and the geometry of
   the answer space.
2. **Conditionals.** `{{#Slots}}` labels, `{{#Code}}` listing, `{{#Diagram}}` figure,
   `{{#Asked}}` lit tab or `core`, `{{#Slide}}` print or plain source line, `{{#Typed}}` input
   or slots. `is-typed` on the root comes from `{{#Typed}} is-typed{{/Typed}}`.
3. **Progressive enhancement with `:has()`.** The baseline back is one solid slot (Structure) or
   one ruled block (Lamp) holding whatever Back contains. When Back is a list, `:has(> ul)`
   turns each item into its own slot under its label, on the rail, or numbered. A sentence where
   a list was expected therefore still renders as one clean slot under the labels (cards 3x and
   4x), and a client without `:has()` shows the same baseline.
4. **Same place on both sides.** Labels sit above their slots on both front and back, so the eye
   finds the answer where the gap was.

| Role | Structure front, back | Lamp front, back |
|---|---|---|
| definition | tall dashed slot, sentence in solid slot | two blank lines, sentence on the ruling |
| reverse, case | short slot, term large in a solid slot | one short line, the term as a headword on it |
| contrast, code | two labelled columns of slots | two labelled columns of lines |
| chain | rail with given steps and dashed gaps, gaps filled | numbered lines, given steps written in |
| name-two | two numbered slots | two numbered lines |
| why | two slots on a rail | "Because" and two lines |
| formula | tall slot, display maths at 118 % | blank plate, statement on an inset plate |
| diagram | 16:10 sketch frame, figure plus one-line slot | dashed sketch frame, figure above the line |
| cloze | dashed gap, filled gap boxed | inset gap with amber underline, highlighter stroke |
| cloze-list | rows, the asked row is the slot | square list, the asked item is the slot |

## Typed answers

See `FIELDS.md` for the rule (code decides; one short term; reverse, case and cloze only) and
the switch (the `Typed` field, wrapped in `{{#Typed}}`).

**Front.** Anki replaces `{{type:Typed}}` with `<center><input type=text id=typeans ...
style="font-family: '...'; font-size: ...px;"></center>`. Both skins undo the centring and the
inline font with `!important`, and style the input as the answer space itself: a dashed slot on
dot grid paper (Structure) or an inset strip with an amber underline (Lamp). The cue reads
"Type the term" or "Type what is missing". The slots are not drawn when typing is on.

**Back.** Anki replaces the same tag with `<div style="..."><code id=typeans>`: the typed text
with `typeGood` / `typeBad` / `typeMissed` spans, `<br><span id=typearrow>&darr;</span><br>`, and
the expected text. The skins hide the line breaks, turn the arrow into a "Correct answer" label,
and label the first line by state with `:has()`: "You typed" when wrong, "Correct" when right,
"Answer, nothing typed" when empty. Wrong characters are struck through and missing ones dotted,
so the result does not depend on colour alone. The comparison replaces the answer slot; Back is
hidden only when `code#typeans` exists, so where no box appears (AnkiWeb, the preview) the card
still shows its answer.

## Fixed from the explorations

- **Diagram labels**: a drawing rule (viewBox at most 300 units, labels at least 11 units) plus a
  figure that bleeds to about 330 px. Measured in the screenshots: about 12 px at 360 and 16 to 17 px at 600.
- **Literal `[...]`**: both skins set the hidden cloze to `color: transparent` inside a sized slot.
  Hints are banned in the contract for that reason.
- **Long inline formulas**: the contract moves any inline formula over 30 TeX characters to
  display maths (card 8's Extra), and display maths in Extra is set at 92 %. The sideways scroll
  stays only as a safety net on display maths.
- **Two-item roles**: the `:has()` baseline above.
- **Night ground**: the `body.nightMode` specificity bug above.

## Contrast (WCAG 2.x, computed from the tokens)

| | Structure light | Structure night | Lamp light | Lamp night |
|---|---|---|---|---|
| Text on ground or sheet | 13.8 | 14.3 | 15.9 | 12.1 |
| Secondary text | 6.8 | 8.3 | 7.3 | 6.0 |
| Cue and "Show slide" | 7.3 | 8.7 | 5.7 | 8.6 |
| Weight tab, asked / core | 11.8 / 6.0 | 10.4 / 6.1 | 7.7 / 7.3 | 8.1 / 6.0 |
| Key term on its highlight | 11.8 | 6.4 | 11.8 | 7.0 |
| typeGood / typeBad / typeMissed | 8.4 / 7.9 / 8.3 | 9.0 / 9.4 / 8.4 | 9.2 / 7.7 / 7.3 | 8.9 / 9.4 / 8.8 |
| Input boundary (3:1) | 3.5 | 3.7 | 3.1 | 8.0 |

Blank ruling, dot grid and dashed frames are decorative and below 3:1 by design.

## What is weakest

- **The typing rule is strict and still imperfect.** `can still decrease` (card 10, c2) passes
  "at most 3 words" but is a phrase, so a student who types "may still decrease" is marked wrong
  on a correct idea. The comparison is character by character and case-sensitive; Anki added a
  case-insensitive `type:ci:` modifier only in October 2026, too new to rely on in mobile
  clients. Worth testing whether cloze typing should require every deletion to be a noun phrase.
- **Lamp's ruling drifts** when a line holds inline maths, inline code or a large mark: the line
  box grows and the text leaves its rule (visible on the code card's back). It reads as
  handwriting, not as an error, but it is not exact.
- **Cue copy lives in CSS.** Changing a cue or adding a role is a note type update, which Lectern
  applies only while the student has not edited the styling. Same for the weight copy, which now
  lives in the template.
- **The Structure head wraps** when a long topic meets a long weight (`Business model` +
  `asked 3×, short answer`): the chip drops to its own line. Clean, but it costs a line.
- **Inline SVG in a field** survives Anki's editor as far as I know, but a student who edits the
  Diagram field in the editor may see raw markup.

## Not verified

- **Real clients.** Everything was rendered by Anki's own template engine, but displayed in
  headless Chrome, not in Anki desktop (Qt WebEngine), AnkiDroid, AnkiMobile or AnkiWeb.
- **AnkiDroid typing.** Not covered by the manual's typing section. AnkiDroid has historically
  offered its own native input instead of the HTML `<input>`; whether it then renders the
  comparison with the same `code#typeans` markup is untested.
- **AnkiMobile typing.** The manual says it supports `typeGood` and `typeBad` but not
  `typeMissed`; the labels and strike-through should still work, the dotted missing characters may
  not appear.
- **`:has()`** needs Qt WebEngine 6.5 or newer, Chrome 105, iOS 15.4. Older clients get the
  baseline: list answers in one slot, no typed-state labels, and on a typed Q&A back both the
  comparison and Back.
- **`<details>` toggling** in AnkiMobile and AnkiDroid, `-webkit-line-clamp` on old iOS.
- **MathJax.** Anki ships its own MathJax 3 build and settings; the gallery loads MathJax 3.2.2
  from a CDN.
- **`html.mobile`** is applied by the gallery at 360 px as the explorations assumed; neither skin
  depends on it (both use a width media query).

## Sources for the Anki behaviour

- Anki manual, Field Replacements, "Checking Your Answer":
  https://docs.ankiweb.net/templates/fields.html#checking-your-answer. Confirms: `{{type:Field}}`
  shows a text box; the comparison uses a monospaced font; "Only one typing comparison can be
  used on a card"; "it also only supports a single line"; `{{type:cloze:Text}}` for cloze
  (several deletions on one card are separated by commas); `type:nc` ignores diacritics and
  `type:ci` ignores case; the classes `typeGood`, `typeBad`, `typeMissed` can be styled;
  "AnkiMobile supports typeGood and typeBad, but not typeMissed"; "the type answer boxes don't
  appear in the preview dialog or in AnkiWeb".
- Anki manual, Card Generation, "Conditional Replacement":
  https://docs.ankiweb.net/templates/generation.html#conditional-replacement. Confirms that
  text, fields or HTML can be included only when a field is empty or not empty, that "Anki will
  not create cards with empty front sides", and that cloze note types have a single card type
  shared by all deletions.
- Anki source at `main`, November 2026: `qt/aqt/reviewer.py` (an empty type field removes the
  box; the exact input and comparison wrappers; the `ci` modifier, added 2026-10-05 in #5264),
  `rslib/src/typeanswer.rs` (comparison markup; nothing typed gives plain `<code id=typeans>`;
  HTML is stripped from the expected text), `rslib/src/notetype/render.rs` (`{{#c1}}` is true on
  the card for deletion 1, not used here but available), `ts/reviewer/reviewer.scss` (the
  default rules the gallery reproduces).
- Ran with `anki` 26.09.4: `{{type:Typed}}` inside `{{#Typed}}` renders, an empty Typed field
  renders nothing, and the comparison output shown in the gallery is the backend's own.

## Open questions

- Should typing be offered to the student as a course setting (all eligible cards, none), with
  code still deciding eligibility? The contract supports both.
- Is `core` worth printing at all before the past-exams expansion, when every card is core?
- Should Structure's topic use Young Serif in a card that is otherwise all sans? It ties the card
  to the map's region names, and it is the first thing to cut if it reads as decoration.
