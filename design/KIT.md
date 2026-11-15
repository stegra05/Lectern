# Lectern v3 design kit, direction v2

Binding for every "V2" screen. It merges what Steffen picked on 2026-11-14: the Native Mac
language (Language C) with the lecture colours and the winding track of the playful one
(Language E), a full-width map, and mind maps. Background and reasons:
[RFD 11](../docs/rfd/0011-app-shape.md).

Reference frames for the look: `AltLangC1.dc.html` and `AltLangC2.dc.html` (controls, type,
materials) and `AltLangE1.dc.html` (lecture colours, the track) in [`canvas/project/`](canvas/).

## Principles

- Controls and chrome are quiet and native. Colour and personality live in the content: the
  lecture colours, the track, numerals, and small considered details.
- The map always has the full width of the window. Nothing is docked beside it permanently.
- No blob shapes. No left-border accent on tabs or cards. No gradients, no emoji.
- Plain language for students who are not technical. No em-dashes anywhere.

## Tokens

| Role | Light | Dark |
|---|---|---|
| Window and map ground | `#EFEFF2` | `#1C1C1E` |
| Group, cards, rows | `#FFFFFF` | `#2C2C2E` |
| Material (floating bar, inspector) | `rgba(250,250,252,0.82)` with `backdrop-filter: blur(20px) saturate(180%)` | `rgba(44,44,46,0.78)` with the same filter |
| Label | `#1D1D1F` | `#F2F2F7` |
| Secondary label | `#636366` | `#AEAEB2` |
| Separator | `rgba(0,0,0,0.10)` | `rgba(255,255,255,0.12)` |
| Neutral mark (unselected dots) | `#7C7C80` | `#98989D` |
| Accent fill (primary button, selected stop ring) | `#0064D2`, white text | `#0064D2`, white text |
| Accent text and icons | `#0064D2` | `#6CB0FF` |
| Selection fill | `#E3EEFB` | `#1F3A5C` |
| Key term mark | `#CFE2FB` | `#27456B` |
| Positive status | `#1A7F37` | `#5FD07A` |
| Problem | `#B3261E` | `#FF8A80` |
| Focus ring | `#4A8BDF`, 3px, 2px offset | `#6CB0FF` |

Type: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`.
Mono for apparatus: `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.
Sizes: title 22px weight 700 with `letter-spacing: -0.01em`, heading 15px weight 600, body 13px,
label 12px weight 500, caption 11px. Big numerals (a count such as 412) may go to 34px weight 700.
Radii: 8px controls, 12px groups and lecture stops, 14px floating panels. Shadows: one soft
layered shadow on floating panels only.

## Lecture colours

Each lecture owns a colour that follows it everywhere: its stop on the track, its mind map
links, its deck bar, its chips, and (in card designs that support it) its cards in Anki.
Colour never stands alone: the lecture number is always shown with it. Numerals on a colour
fill are `#1D1D1F` in both modes.

| 01 | 02 | 03 | 04 | 05 | 06 |
|---|---|---|---|---|---|
| `#FFC629` | `#FF7A33` | `#FFA3D1` | `#A487FF` | `#7FD0FF` | `#FF6B6B` |

| 07 | 08 | 09 | 10 | 11 | 12 |
|---|---|---|---|---|---|
| `#B6E33A` | `#1FB5B0` | `#56E0B0` | `#7B93FF` | `#DDB3FF` | `#E8C39E` |

From lecture 13 on the colours repeat in the same order.

## The frame inside a course

Window 1100 by 720. It must hold before and after generation.

- **Title bar**, 38px: window controls, breadcrumb, and in the centre a two-way switch
  "Lectures" and "Themes". On the right a settings button.
- **Map**: everything below the title bar, edge to edge.
- **Bottom bar**: a slim floating material bar, 12px from the left, right and bottom edges,
  56px tall. It never grows and has no grabber. Left: one line of status. Then a quiet
  "Details" button that opens the side panel with the course-level content. Right: the one
  primary action of the moment. The primary action always lives here, never in the panel.
- **Side panel**: the one place for details. A floating material panel on the right, 344px
  wide, 12px from the top and right edges, ending 8px above the bottom bar, with a close
  button. Closing it returns the full-width map. It shows one of:
  - the cards of the selected lecture, topic or concept;
  - course details, opened by "Details": two tabs, "Decisions" (what Lectern decided, and the
    deck as one bar per lecture in the lecture colours) and "Statistics";
  - before generation, the setup: what was found in the files and the goal question. It is
    open by default then, because there is something to answer;
  - during the run, the engine's real phases as a checklist. Open by default then too.

  Decided 2026-11-14: Steffen chose the side panel over a bar that pulls up, after research
  showed bottom sheets are a mobile pattern and desktop tools put details on the right.
- **Map tools**, top left: zoom out, zoom in, fit, and the current level in words. Top right
  (left of the inspector when it is open): "Copy for chat".

## The map

Two views, switched in the title bar.

**Lectures.** The course is a winding track, a snake that fits the window. Lectures are stops
along it in course order: rounded squares of 40px in the lecture's colour with its number.
Under each stop: the lecture title (13px, weight 600) and "52 cards" (11px, secondary). Above
each stop a short fan of small dots, one per topic, in the lecture colour, hinting at the mind
map inside. The track is a soft band, 10px wide, `rgba(0,0,0,0.08)` in light and
`rgba(255,255,255,0.10)` in dark. It ends at a flag stop named "In Anki": dashed until the
cards are sent, filled with the accent afterwards. Lectures that have not arrived yet are
dashed, empty stops.

For 11 lectures at 1100 by 720 with no inspector: rows at y 190, 350 and 510 measured from the
top of the window; x at 160, 420, 680 and 940. Row one runs left to right (01 to 04), row two
right to left (05 to 08), row three left to right (09 to 11, then the flag). A course with 17
or more lectures uses five stops per row and more rows.

**Inside a lecture.** Clicking a stop zooms in. The lecture becomes the centre of a mind map
drawn as rings (Steffen's pick, 2026-11-14: a centre piece with branches in all directions,
not a tree growing sideways):

- The centre is the lecture's stop: its colour, number and title, with the card count.
- The **inner ring** carries the topics as pill nodes, spread evenly around the centre.
- The **outer ring** carries the concepts. Each concept sits in the sector of its topic, as a
  dot whose size is the number of cards, with its name and count beside it. Labels are always
  horizontal and sit outside the ring, left-aligned on the right half and right-aligned on the
  left half, so they never run through the map.
- Spokes join centre to topic and topic to concept: 1.5px, in the lecture colour.
- Two thin guide circles may show the rings. No filled shapes around groups.
- A sector's width follows its number of concepts, so nothing crowds. The shape must still read
  with four topics and twelve concepts.
- The previous and next stops stay visible at the edges, faded, so it reads as a zoom.
- A selected concept gets the accent ring and the selection fill, and its cards open in the
  side panel.

**Themes** (an expansion after the base product). The same concepts, grouped by course-wide
themes that cut across lectures, in the same ring shape: the course in the centre, the themes
on the inner ring, and on the outer ring the concepts of the theme that is open, in that
theme's sector. Themes that are not open show their concept count. Each concept carries small
chips with the numbers and colours of the lectures it appears in. Selecting a concept opens
its cards in the side panel.

**The map never reshuffles.** Opening or closing the side panel changes only the viewport: the
map slides, and zooms out a little if needed, so that the track or the selection stays in view
in the area left of the panel. Zooming changes positions only. Stops, dots and labels keep
their size. The track keeps its shape at all times: the same stops per row, the same turns.

A node shows its name and leads to its cards. The map is for overview, navigation and seeing
how topics relate, not for studying from.

## Card designs

Six designs ship as choices, all over the same fields and templates: **Native** (the default
for a new student), Structure, Lamp, Lecture colours, Afterglow and Vitrine. Placard was
dropped. The choice is made in settings and offered once before the first send, in a carousel.

On the Lecture colours card the colours are softer than on the app's track: the same twelve
hues, toned down for daily review. The app's track keeps the full colours.

## App icon

The hand of stops: four lecture stops (02 to 05, in course order left to right) fanned like a
hand of cards behind the 01 stop, whose face is a card with a cloze gap. White ground in light,
`#1C1C1E` in dark, greyscale for tinted. Master and generator: `design/icon/master.py`,
output in `design/icon/master/` (masked SVGs plus unmasked layers for Icon Composer).
Picked by Steffen on 2026-11-14 over five rounds; rejected: dots on stalks (reads as a virus),
the flat lamp (reads as a figure in a hat when small), the track, rings and a plain deck.

## Copy for chat

The copied text is a tutoring prompt followed by the course as a Markdown outline: lectures,
topics, concepts, and under each concept its cards as question and answer. The cards already
exist and were checked against the slides, so the engine writes nothing extra for this.

## Base product state

One question (the goal). No study plan, no quiz, no exam marks, no feedback loop. Past exams
are not used.
