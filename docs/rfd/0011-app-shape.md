# RFD 11 · The app: a native window, a snake of lectures, rings

|           |                                                                                         |
| --------- | --------------------------------------------------------------------------------------- |
| **State** | decided, "right direction, needs polish"                                                |
| **Date**  | 2026-11-13 (first review), 2026-11-14 (second review, two interviews, Direction v2)     |
| **Kit**   | [`design/KIT.md`](../../design/KIT.md), binding                                          |
| **Canvas**| [Direction v2](https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE), the source of truth for screens |

> **In one breath.** It looks like a native app on each system, colour lives in the content,
> the course is a winding track of coloured lectures, a lecture opens as rings, and one side
> panel holds every detail.

## Decision

- **Native look per system, light and dark** from the base. Play lives in the content, not in
  the controls: a colour per lecture, the winding track, small details.
- **Inside a course the frame never changes**, before and after a run. Course list, settings
  and first run are separate screens.
- **The track is a snake** of lecture stops in course order. Clicking a stop zooms into the
  lecture.
- **A lecture is rings**: the lecture at the centre, topics on an inner ring, concepts on an
  outer ring. A node shows its name and opens its cards. The map is for finding, not studying.
- **A slim bottom bar that never grows, and one side panel on the right** for all details: the
  cards of a selection, course details (Decisions, Statistics), the setup before a run, the
  phases during it. When the panel opens, the map slides. It never reshuffles.
- **Files go straight onto the track.** No separate files screen.
- **The run** shows the engine's real phases and the map growing. Not a per-lecture ledger,
  because the engine reads the whole course before it writes.
- **Settings in sections**, with the card design carousel ([RFD 10](0010-card-designs.md)).
- **Personality** to borrow: calm craft (Things, Craft), colour play in a native app (Amie,
  Arc), small delights (Family, Notion). Not the journey-on-a-path references.

## Why

At the second review Steffen disliked the blob map, the unclear files screen, a run animation
that was not good enough, and a layout that changed after generation. He wanted the map to
behave like a map. For the panel, research favoured a right-hand inspector on wide windows:
NN/g defines bottom sheets for mobile, and desktop canvas tools (Felt, Figma) put details in a
right sidebar. His call: "Side panel then."

## Given up

- **The survey sheet look** (dotted paper, Young Serif, a yellow highlighter), first picked on
  2026-11-13. Replaced by Native Mac.
- **The desk** (a binder of lit tabs and a brass lamp). Only its provider choice survived.
- **The conversation's result**, a prose report: too little information. Its first-run wording
  and sentence-with-blanks questions survived.
- **Map styles** Graph, Territories and Lines. None looked good enough; rings replaced them.
- **A pull-up bottom drawer** in three heights. No source supported it on desktop, and at 720 px
  it cost half the map.
- **Reflowing the track** when the panel opens.

## Open

- Apply the personality references and polish, and judge the statistics content:
  [#115](https://github.com/stegra05/lectern/issues/115).
- The themes view, concepts grouped by course-wide themes, comes after the base:
  [#107](https://github.com/stegra05/lectern/issues/107).
- The course profile as one line to confirm: [#132](https://github.com/stegra05/lectern/issues/132).
