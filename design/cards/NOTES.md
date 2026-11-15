# Cards: the Native design

## The idea

One field contract and one set of four templates; the design is a stylesheet, and Native is the
only one Lectern ships ([RFD 10](../../docs/rfd/0010-card-designs.md)). Every card shows the shape
of its answer on the front and fills the same shape on the back, names that shape in one cue
line, and carries a print of its source slide at the foot of the back. The other designs are
[#193](https://github.com/stegra05/lectern/issues/193).

## Files

- `packages/engine/anki/front.html`, `back.html`, `cloze-front.html`, `cloze-back.html`: the shared templates.
- `packages/engine/anki/style-native.css`: the stylesheet. System fonts, light and night.
- `FIELDS.md`: the field contract. `Typed` is in it and always empty.
- `gallery.html`: the Native cards, with switches for light or night, 360 or 600 wide, slide open
  or closed. URL parameters: `?cards=2,10&mode=both&w=360&slide=open`.
- `build.py` + `gallery.src.html`: rebuild with `uv run --with anki python build.py`.
- `media/`: mock slides the gallery cards cite. `shots/`: a screenshot of the gallery.

## How the gallery stays truthful

`build.py` does not imitate Anki's template language. It installs the two note types into a
throwaway collection with the `anki` package (26.09.4 from PyPI), adds every sample as a real
note and takes `card.question()` and `card.answer()`. Each card is shown in its own iframe with
`body.card.cardN`, `nightMode night_mode`, `html.mobile` at 360 px, and the default rules of
Anki's `ts/reviewer/reviewer.scss` underneath the design.

That last part found a bug: the reviewer sets `body.nightMode { background-color: var(--canvas) }`,
which outranks `.card { background-color }`. In real Anki desktop a night mode would show Anki's
grey canvas instead of the design's own ground. The design sets the ground on
`.card, .card.nightMode`.

## How role adaptation works (no JavaScript)

1. **Role as a class.** `role-{{Role}}` picks the cue text (CSS `content`) and the geometry of
   the answer space.
2. **Conditionals.** `{{#Slots}}` labels, `{{#Code}}` listing, `{{#Diagram}}` figure,
   `{{#Asked}}` lit tab or `core`, `{{#Slide}}` print or plain source line.
3. **Progressive enhancement with `:has()`.** The baseline back is one solid slot holding
   whatever Back contains. When Back is a list, `:has(> ul)` turns each item into its own slot
   under its label. A sentence where a list was expected still renders as one clean slot under
   the labels, and a client without `:has()` shows the same baseline.
4. **Same place on both sides.** Labels sit above their slots on both front and back, so the eye
   finds the answer where the gap was.

## What is weakest

- **Cue copy lives in CSS.** Changing a cue or adding a role is a note type update, which Lectern
  applies on a send, only while the student has not edited the styling. Same for the weight copy,
  which lives in the template.
- **Inline SVG in a field** survives Anki's editor as far as I know, but a student who edits the
  Diagram field in the editor may see raw markup.

## Not verified

To be checked in real clients: [#134](https://github.com/stegra05/lectern/issues/134).

- **Real clients.** Everything was rendered by Anki's own template engine, but displayed in
  headless Chrome, not in Anki desktop (Qt WebEngine), AnkiDroid, AnkiMobile or AnkiWeb.
- **`:has()`** needs Qt WebEngine 6.5 or newer, Chrome 105, iOS 15.4. Older clients get the
  baseline: list answers in one slot.
- **`<details>` toggling** in AnkiMobile and AnkiDroid, `-webkit-line-clamp` on old iOS.
- **MathJax.** Anki ships its own MathJax 3 build and settings; the gallery loads MathJax 3.2.2
  from a CDN.
- **`html.mobile`** is applied by the gallery at 360 px; the design does not depend on it (it
  uses a width media query).

## Open

- The `core` label: [#129](https://github.com/stegra05/lectern/issues/129).
