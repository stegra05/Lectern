# Afterglow (file name `night`)

## The idea

Most reviews happen in bed with the lights off, so the dark version is the design and the
light version is derived from it. The answer is the only light on the screen: the front draws
the answer space as a row of unlit dots, the back draws the same line lit in phosphor green
with the key term glowing on it, like the glow-in-the-dark stars on a bedroom ceiling.

## Files

- `../../anki/style-night.css`: the stylesheet. Uses the bundled `_StructureSans.woff2`
  (Atkinson Hyperlegible Next) and `_LampMono.woff2` (IBM Plex Mono). No template change.
- `gallery.html`: all 17 cards, night and light, 360 and 600, slide open or closed. Night is
  shown first and the gallery chrome is dark, so the cards are judged in the dark.
- `overview.png` (1600 by 1000) from `overview.html`.
- `build.py`: imports `../../build.py` unchanged (Anki's own engine, the shared templates) and
  only moves the output here. `uv run --with anki python build.py` writes both pages.

## Decisions that define it

1. **One luminous tone, owned by the answer.** Phosphor green `#a6f2c9` is the brightest thing
   on the card (13.9:1, above body text at 12.3:1). It appears only on the key term, the
   revealed cloze, the lit line, a correct typed answer and the key cells of a diagram.
   Apparatus (head, cue, weight, labels, source) is one quiet lavender grey `#9a9cb8` (6.7:1).
2. **The back is never brighter than the front.** When the answer appears the question steps
   down to a dimmer, smaller line and the rest of a cloze sentence dims, so the light moves to
   the answer instead of being added. The answer fades up over 420 ms (off under reduced
   motion) and casts a faint radial pool on the ground around it.
3. **Nothing on the card is white.** No sheet (a lit card on a dark screen is a glare edge):
   the screen is the card. Slides, thumbnail and opened, are inverted with a hue rotation so
   their accent colours survive, then set at 80 % so the ground shows through. Code sits on a
   ground only one step lighter. Diagrams are drawn in `currentColor`.
4. **Night typography.** Light text on dark blooms, so night text is one weight lighter
   (370 against 420 by day) with a little tracking, in a warm off-white `#d9d5c9` rather than
   white. Light mode gives that weight back.
5. **Light is derived, not designed separately.** The same tokens with lightness flipped:
   pale blue-grey ground, deep ink, phosphor becomes a deep green `#0f5c3f` on a pale mint band,
   halos and the pool switch off.
6. **Weight as a star.** `asked` is a lit four-pointed star and a brighter apparatus tone, core
   an outlined one. No colour block in the head.

Answer-shaped slots are kept exactly: unlit dot lines in the same place as the lit lines,
labels above both, numbered lines for chain and name two, "Because" for why, a dark recess for
formula (the back puts the display maths on a lit plate), a dotted sketch frame for diagram.

## Contrast (WCAG 2.x, from the tokens)

| | Night | Light |
|---|---|---|
| Text on ground | 12.3 | 14.3 |
| Dimmed question, code text | 8.8 | 9.1 |
| Apparatus (cue, head, source) | 6.7 | 5.8 |
| Key term (night on ground, light on its band) | 13.9 | 6.4 |
| typeGood / typeBad / typeMissed | 9.4 / 7.7 / 8.4 | 8.2 / 7.4 / 8.7 |
| Input boundary | 6.2 | 5.3 |

Dot lines and the lit line are decorative; the lit line by day is 3.7:1.

## What is weakest

- **Inverting slides is right for text slides and wrong for photos**, micrographs or anything
  where colour carries meaning: a photo turns into a negative. Lectern renders slides as
  images and cannot tell them apart in CSS. A per-note `Slide` class from code (text slide or
  picture slide) would fix it; until then a photo slide looks odd at night.
- **The glow is subtle by design** and may vanish on a dim OLED at low brightness, leaving the
  green colour alone to carry the answer. It is still the brightest tone, so nothing breaks.
- **The head wraps** when a long topic meets a long weight (cards 7 and 10): the star drops to
  its own line on the right.
- **Light mode is competent but less characterful**: without darkness the glow has no stage.
  That is the honest cost of designing night first.

## Not verified in real clients

- Rendered by Anki's template engine and shown in headless Chrome only, not Anki desktop
  (Qt WebEngine), AnkiDroid, AnkiMobile or AnkiWeb.
- `filter: invert() hue-rotate()` on images and `text-shadow` glow on old WebViews; the
  `@keyframes` fade when AnkiDroid or AnkiMobile reuse the webview between front and back.
- `:has()` for list answers and typed labels (Qt WebEngine 6.5, Chrome 105, iOS 15.4); older
  clients get one lit line for the whole answer.
- Night tokens are the default and light applies only to `.card` without `nightMode` or
  `night_mode`. A client that sets night on an ancestor instead of `body.card` is covered by a
  separate selector, but untested. A client that never sets either class shows light.
- MathJax colour on the lit formula plate with Anki's bundled MathJax (the gallery loads
  MathJax 3.2.2 from a CDN, as the shared gallery does).
