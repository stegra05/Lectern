# Native

## The idea

The card is a well-made system screen: a grey ground, white inset groups, hairline rows, the
system font, and type size and weight doing all the hierarchy. One blue means "this is the
answer": the trailing checkmark on every answer row, the tint behind the key term and the
filled cloze, and nothing else on the card is blue.

## Files

- `../../anki/style-native.css`: the whole design. No template change, no font file.
- `gallery.html`: all 17 cards (12 samples, typed 2t, 10t, 12t, fallbacks 3x, 4x), front and
  back, light and night, 360 px by default. `?w=600`, `?mode=light`, `?slide=open`, `?cards=3,9`.
- `overview.png` (1600 by 1000) from `overview.html`.
- `build.py`: a copy of the shared build that reads the shared templates and writes into this
  folder. Rebuild with `uv run --with anki python build.py` from this folder.
- `shots/`: the checking screenshots.

## Decisions that define it

- **Answer-shaped slots are grouped lists.** The front shows a white inset group with empty
  rows in the shape of the answer; the back fills the same rows. Contrast and code: one row
  per side with the label as the row caption. Chain, name two, why: numbered rows, given
  chain steps written in. Definition and formula: one tall row. Diagram: a 16:11 frame that
  bleeds to 8 px from the screen edge, so the canvas labels render at about 12 px.
- **The checkmark is the accent.** As iOS marks the chosen row, every answer row carries a
  trailing blue check. A typed answer gets it only when it was right. Cues are plain section
  headers in secondary grey; the slide toggle is a grey disclosure chevron, not blue, so blue
  never means "tap here".
- **The head row is the app's lecture stop.** A 40 px rounded square with the lecture number,
  the topic as the row title, the exam weight as its subtitle: a filled capsule for "Asked 6×,
  multiple choice" (label ink, weight 600), plain grey text for "Core". The difference does
  not depend on colour.
- **Spacing and type scale.** 16 px gutter and row inset, 12 px group radius, 52 px minimum row
  height (touch size), 26 px from question to cue, 28 px before the slide row. Question 21 px
  bold at 360 (24 px wider), dimmed to 17 px medium grey on the back so the answer group leads.
  Answer 17 px, terms for reverse and case 24 px bold, captions 13 px. Extra reads as the
  group footer at 15 px.
- **Cloze list is a real grouped list**, the asked item an empty bordered field in its row,
  filled in blue with the check on the back. Plain cloze gaps are small white fields inline.
- **Tokens from `design/KIT.md`**, light and night. Contrast (WCAG 2.x, computed): label on
  ground 14.7 / 15.2, secondary on ground 5.2 / 7.7 (on group 6.0 / 6.3), accent on group
  5.6 / 6.2, filled cloze on its tint 4.8 / 5.1, key term on its tint 12.8 / 8.8, asked capsule
  12.8 / 11.5, typeGood / typeBad 5.6 / 6.5 light and 7.4 / 7.4 night, input and gap boundary
  3.4 / 4.2 on the group (3.0 on the light ground).

## What is weakest

- **The lecture tile is neutral.** The app gives every lecture a colour, and the tile is the
  obvious place for it, but the templates expose the lecture number only as text, so CSS cannot
  pick a colour. A class `lec-{{Lecture}}` on `.lc` would allow it (template change, not made).
- **Restraint costs recognition at a glance.** Without a lit tab, the exam weight is a grey
  capsule; an often-asked card does not shout. Deliberate, but weaker than Structure's
  highlighter chip.
- **The diagram row breaks the inset.** The diagram group bleeds 8 px wider than other groups,
  so its caption row sits 8 px left of every other row's text.
- **Light-ground boundary of the empty field is exactly 3.0:1** where the cloze gap sits on the
  grey ground (the question text), so it passes with no margin.
- **The key term tint and the filled cloze tint are close.** Both are the accent's family by
  design ("this is the answer"), but on a cloze back that also has a `<mark>` in Extra they read
  alike.

## Not verified in real clients

- Rendered by Anki's template engine (anki 26.09.4) in headless Chrome, not in Anki desktop
  (Qt WebEngine), AnkiDroid, AnkiMobile or AnkiWeb.
- **CSS masks** (`mask` with an inline SVG data URI) draw the checkmark and chevron. Supported
  in Chrome 120+, Safari 15.4+ and with `-webkit-mask` earlier; an old client shows no check or
  chevron, the answer still reads.
- **The system font** is SF on Apple, Segoe UI on Windows, Roboto on Android; widths differ, so
  line breaks will differ from the screenshots (all made with SF).
- **`:has()`** (list answers as separate rows, typed-state labels, conditional check) needs
  Qt WebEngine 6.5, Chrome 105, iOS 15.4. Without it list answers show as one row with bullets.
- `display: contents` on the head and sheet, and `::first-letter` capitalising the weight line,
  are untested in AnkiMobile and AnkiDroid's WebView.
- MathJax comes from a CDN in the gallery; Anki ships its own build.
