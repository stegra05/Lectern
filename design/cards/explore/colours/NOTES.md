# Lecture colours

## The idea

Every card wears the colour of the lecture it comes from, the same hue as that lecture's stop
on the course track in the app, so after a few weeks a student knows where a card belongs before
reading it. On the cards the hue is softened for daily review: a pale tint of it is the head and
the answer fill, and the full colour appears only on the lecture numeral's stop and small accents.

## History

The first version had a full-saturation colour field as the head, thick ink outlines and a 4px
drop under every answer. The owner kept the design but found it too loud for review ("lecture
colours needs to have softer colours"), for the cards only; the app's track keeps the full
colours. This version keeps the twelve hues in KIT order and moves the full colour onto a small
stop.

## Files

- `../../anki/style-colours.css`: the skin. The palette block inside it is written by
  `palette.py`; edit the script, not the block.
- `build.py`: copy of `../../build.py` that reads the shared templates in `../../anki/` and writes
  `gallery.html`, `overview.html` and `media/` into this folder. Run with
  `uv run --with anki python build.py`. The `anki` package keeps the process alive after it
  writes; wrap it in a timer.
- `gallery.src.html`, `overview.src.html`: the page shells. `overview.png` is a 1600 by 1000
  screenshot of `overview.html`.
- `palette.py`: writes the lecture palette into the stylesheet and prints the contrast table.

## Template hook

A stylesheet cannot read the text of `{{Lecture}}`. The shared templates now carry it as a class
on the root div, approved by the owner and applied to all four files in `../../anki/`:

```
<div class="lc lc-front lec-{{Lecture}} role-{{Role}}...">
```

Lecture is always two digits, so the class is `lec-02`. `FIELDS.md` documents it on the Lecture
field. Structure and Lamp do not use the class; the shared gallery rebuilt with it is identical
to the previous one apart from the added tokens.

## Decisions that define it

1. **A pale head with a full-colour stop.** The head is a tint of the hue (20 % into white) with
   a 2px edge of the hue darkened into ink; on its left a 58px rounded stop in the full colour
   carries the lecture numeral in `#1D1D1F`, like the stop on the track. Lectures stay apart at a
   glance through the stop and the tinted head, without a loud field. The exam weight is a pill
   in the head's corner: filled for "asked", an outline for "core".
2. **Colour comes from data, with full coverage.** The twelve KIT colours in KIT order, repeating
   from 13, generated for every number from `lec-01` to `lec-99`. A card without a lecture gets
   neutral grey. Each lecture has seven precomputed values (colour, light fill, light mark, light
   edge, night fill, night mark, night edge), so the skin needs no `color-mix()`.
3. **Answer shape, rounded and quieter.** Front slots are 2px dashed boxes with 18px radius; back
   answers are the same boxes filled with the head tint and edged in the darkened hue. The key
   term and the filled cloze are a mid tint of the hue (light) or a muted hue (night) with dark
   text, bold, so they never depend on colour alone. Chain and why run on a 5px rail in the hue
   with round stops, the course track in small.

Type: `ui-rounded` (SF Pro Rounded on Apple WebKit), then Arial Rounded MT Bold (macOS), then
Nunito or Varela Round if installed, then the system sans. Rounded type for the numeral, topic,
question and the large reverse or case answer; system sans for answers and labels; system mono for
code and the typed comparison.

## Contrast (WCAG 2.x, computed by `palette.py`)

| Lecture | Colour | Light fill / mark / edge | Night fill / mark / edge | Ink on colour | Ink on light fill / mark | Light edge on white | Night text on fill | Ink on night mark | Night edge on ground |
|---|---|---|---|---|---|---|---|---|---|
| 01, 13 | `#FFC629` | `#FFF4D4` `#FFE089` `#8E7224` | `#5F512D` `#D9AA2A` `#AF8B2B` | 10.7 | 15.3 / 13.0 | 4.6 | 7.0 | 7.8 | 5.3 |
| 02, 14 | `#FF7A33` | `#FFE4D6` `#FFB68F` `#8E4C29` | `#5F3F2F` `#D96C32` `#AF5C31` | 6.5 | 13.9 / 9.9 | 6.5 | 8.4 | 4.9 | 3.6 |
| 03, 15 | `#FFA3D1` | `#FFEDF6` `#FFCCE6` `#8E6078` | `#5F4955` `#D98EB4` `#AF7693` | 9.1 | 15.0 / 12.0 | 5.1 | 7.3 | 6.8 | 4.7 |
| 04, 16 | `#A487FF` | `#EDE7FF` `#CDBDFF` `#60528F` | `#494260` `#8E77D9` `#7664B0` | 6.0 | 14.0 / 9.9 | 6.8 | 8.4 | 4.6 | 3.4 |
| 05, 17 | `#7FD0FF` | `#E5F6FF` `#B9E5FF` `#4E768F` | `#405360` `#70B2D9` `#5F92B0` | 9.9 | 15.2 / 12.6 | 4.9 | 7.2 | 7.3 | 5.0 |
| 06, 18 | `#FF6B6B` | `#FFE1E1` `#FFAEAE` `#8E4445` | `#5F3B3D` `#D96060` `#AF5354` | 6.1 | 13.7 / 9.6 | 6.9 | 8.6 | 4.6 | 3.4 |
| 07, 19 | `#B6E33A` | `#F0F9D8` `#D7F093` `#6A802C` | `#4D5831` `#9DC238` `#829D35` | 11.3 | 15.4 / 13.4 | 4.4 | 6.8 | 8.2 | 5.5 |
| 08, 20 | `#1FB5B0` | `#D2F0EF` `#84D6D4` `#1E6968` | `#294D4D` `#219C99` `#24817F` | 6.6 | 14.0 / 10.1 | 6.4 | 8.3 | 5.0 | 3.7 |
| 09, 21 | `#56E0B0` | `#DDF9EF` `#A2EED4` `#3A7E68` | `#36574D` `#4EC099` `#469C7F` | 10.2 | 15.1 / 12.6 | 4.8 | 7.2 | 7.5 | 5.1 |
| 10, 22 | `#7B93FF` | `#E5E9FF` `#B6C4FF` `#4C588F` | `#3F4560` `#6D80D9` `#5D6CB0` | 6.0 | 14.0 / 9.9 | 6.8 | 8.4 | 4.6 | 3.4 |
| 11, 23 | `#DDB3FF` | `#F8F0FF` `#ECD5FF` `#7D688F` | `#564C60` `#BD9BD9` `#9A80B0` | 9.6 | 15.1 / 12.4 | 4.9 | 7.2 | 7.1 | 4.9 |
| 12, 24 | `#E8C39E` | `#FAF3EC` `#F2DECA` `#82705E` | `#595049` `#C6A88A` `#A18A73` | 10.2 | 15.3 / 12.9 | 4.7 | 7.1 | 7.5 | 5.2 |

"Ink on colour" covers the numeral stop and the numbered stops. Light edges on the light fill:
at least 4.1. Labels inside a fill (typed-answer captions): `#3A3A3C` on the light fill at least
9.2, `#E5E5EA` on the night fill at least 6.1. Neutral text: secondary `#545458` on white 7.4,
`#AEAEB2` on `#1C1C1E` 8.4. Dashed slot edges: `#6E6E73` on white 5.1, `#98989D` on `#1C1C1E`
6.3. The rail is decorative.

## What is weakest

- **Neighbouring tints are close.** The light heads of 01 (yellow), 12 (beige) and 02 (orange),
  or 04 and 10 (two violets), are hard to tell apart by fill alone; the full-colour stop and the
  numeral do the separating. That is the price of the softer fill.
- **Rounded type depends on the platform.** Mac and iOS get a rounded face; Windows and Android
  fall back to Segoe UI or Roboto bold. Bundling a rounded OFL face would fix it; the brief
  allowed only fonts already in `anki/`.
- **The overview crops** the backs of the tall cards (a fade marks the cut); the gallery shows
  them whole.

## Not verified

- Real clients: rendered by Anki's template engine (`anki` 26.09.4), displayed in headless Chrome
  only, not in Anki desktop (Qt WebEngine), AnkiDroid, AnkiMobile or AnkiWeb.
- `ui-rounded` in AnkiMobile, and whether Qt WebEngine on macOS finds Arial Rounded MT Bold the
  way Chrome does.
- `:has()`, `<details>`, `-webkit-line-clamp` and typed-answer markup in mobile clients, as in the
  shared `NOTES.md`.
- Whether students learn the lecture-to-colour mapping over a semester, and whether colours
  repeating from lecture 13 confuse long courses (the numeral tells 01 and 13 apart).
