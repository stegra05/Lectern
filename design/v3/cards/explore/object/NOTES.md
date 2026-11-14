# Vitrine

Stylesheet: `design/v3/cards/anki/style-object.css`. Gallery: `gallery.html` (all 17 cards, light
and night, 360 or 600, slide open or closed). Overview: `overview.png`. Rebuild both with
`uv run --with anki python build.py` from this folder; `build.py` is a copy of the shared one that
reads the unchanged templates in `../../anki/` and writes only into this folder.

## The idea

Every card is a museum wall: the question is the wall label, the answer is the exhibit, and on
the front the exhibit's case stands empty, a niche cut into the wall in the shape of what you
have to recall. On the back the object sits in the same niche on a lit white panel, and an
extended label below gives the context and the credit line with the source slide.

## Why the museum wall label

A wall label is the most compressed, most read piece of knowledge-keeping design there is:
people read thousands of them standing up, in seconds, and the genre has settled rules for
exactly the parts a Lectern card has. Its hierarchy (bold title, a quiet medium line, an
interpretive text, a small credit line) maps one to one onto question, role cue, Extra and
Source, so the object drives the structure instead of decorating it. The vitrine adds the one
thing a label lacks: a place for the answer whose shape you can see while it is empty. Paper
objects (index cards, exam sheets, catalogue cards) were out by the brief; a departure board or
a ticket is too loud for 200 reviews a day.

## Decisions that define it

- **Wall, label, niche, exhibit.** Four surfaces with fixed jobs. The wall (deep spruce green,
  `#2f4a46`; after hours `#101816`) carries only signage: the room sign (lecture number and
  name), the exam-weight marker, slot names and step numbers. White labels carry text to read.
  Niches are recesses with an inset shadow; exhibits are white panels with a drop shadow. Front
  to back, a hollow becomes an object in the same place, which is the answer-shaped slot in this
  design's own terms.
- **The cue is the medium line.** On a label the line under the title says what the object is
  made of ("Oil on canvas"). Here it says what the answer is made of: role in bold, shape in
  regular (`Contrast both sides`, `Formula the statement and its condition`). It closes the label,
  so the label is identical on front and back and the eye never has to find the question again.
- **Exam weight is the tour marker.** Museums mark the highlights of a tour with a small sign next
  to the label. Asked by past exams: a filled white marker. Core: an outline. Fill versus outline,
  so the difference does not rest on colour.
- **One typeface, one colour.** Labels are set in one grotesk (system Helvetica Neue, Helvetica,
  Arial, Roboto on Android), distinguished only by weight and size, with tabular figures. No
  bundled font. The only hue is the wall; the key term mark is bold with an underline drawn in
  the wall's green.
- **Role geometry.** Definition: a tall niche. Reverse and case: a short niche, the term set
  large on its panel. Contrast and code: two niches under names painted on the wall. Name two,
  why and chain: numbered niches, the number on the wall like a tour stop; given chain steps
  stand on the wall with no niche because they are already on display. Formula: a tall niche,
  display maths at 118 %. Diagram: a 16:10 niche on the front, a framed picture bleeding to 6 px
  from the screen edge on the back. Cloze: the gap is a niche cut through the label (dark wall
  showing through white); filled, it is a bold term on a pale green tint. Cloze list: lead-in as
  title, items as label lines, the asked line is the niche. Typed: the input is the niche, so the
  student puts the object into the empty case; the comparison is the exhibit on the back.
- **Extended label.** Extra and the slide print join into one second label below the exhibit,
  split by a rule: interpretive text, then the credit line (source bold, two-line excerpt,
  thumbnail, Show slide).
- **Night mode, "after hours".** The wall goes almost black, labels become dark slate, and the
  exhibit panel is the lightest surface on the card, so it still reads as lit.

## Contrast (WCAG 2.x, computed from the tokens)

| | Light | Night |
|---|---|---|
| Text on label / on exhibit | 17.6 / 17.6 | 13.3 / 11.3 |
| Secondary text on label / exhibit | 7.1 / 7.1 | 7.5 / 6.4 |
| Room sign on wall / secondary wall text | 9.6 / 6.4 | 15.3 / 8.3 |
| Asked marker / core marker | 12.8 / 6.4 | 15.3 / 8.3 |
| Show slide | 7.6 | 8.9 |
| Filled cloze on tint | 14.6 | 8.7 |
| Typed input text / boundary | 12.8 / 6.4 | 16.8 / 8.3 |
| typeGood / typeBad / typeMissed | 8.3 / 7.9 / 8.7 | 8.9 / 9.4 / 8.5 |

Niche shading, panel shadows and the key-term underline are decorative; the key term is also bold.

## What is weakest

- **Light mode is not a light page.** The wall is dark green in both modes, and on a phone it
  shows as a 12 px frame plus the bands between label, exhibit and extended label. Reading
  happens on white, but someone who wants a bright card overall will see a dark one. Lightening
  the wall to a mid tone drops the signage below AA, so the choice is deliberate, and the most
  likely thing to be argued with.
- **Night niches are near black** (`#070b0a`), which reads as a hole rather than a soft recess.
  Calm, but the strongest contrast on the night front is the empty part.
- **The room sign wraps** when a long topic meets a long weight (`Inner product spaces` with
  `asked 4×, proof question`): the marker drops to its own line on the right.
- **The key term departs from the app's yellow highlighter.** It is bold with a green underline,
  to keep the one-colour rule. If yellow must mean "this matters" everywhere, the mark is the one
  place to break the rule.
- **The code listing sits inside the label** on a faint tint, so the label gets tall on code cards
  (16 lines fill most of a phone screen before the niches appear).
- **System grotesk.** Helvetica Neue on Apple, Arial elsewhere, Roboto on Android: the label looks
  slightly different per platform. Bundling a grotesk would fix it, but none is bundled.

## Not verified in real Anki clients

Same limits as the shared gallery: rendered by Anki's own template engine (`anki` 26.09.4) and
shown in headless Chrome, not in Anki desktop, AnkiDroid, AnkiMobile or AnkiWeb.

- Inset and drop shadows on `<input>` in AnkiDroid and AnkiMobile, which may draw their own
  native input instead.
- `:has()` (Qt WebEngine 6.5+, iOS 15.4+): without it, list answers stay in one panel and the
  typed labels disappear, as in the existing skins.
- `text-decoration-thickness` and `text-underline-offset` on old iOS: the key term stays bold.
- The `display: contents` sheet with ordered flex children, inherited from Structure's approach,
  in very old WebViews.

No template change was needed.
