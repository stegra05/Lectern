# RFD 10 · Native, the one card design of v3.0

|           |                                                                    |
| --------- | ------------------------------------------------------------------ |
| **State** | decided                                                            |
| **Date**  | 2026-11-13 (two skins), 2026-11-14 (six designs, default), 2026-11-16 (Native only) |
| **Code**  | `packages/engine/anki/style-native.css`, gallery in `design/cards/`     |

> **In one breath.** One set of templates and one stylesheet, Native. The other five designs
> come later as a choice ([#193](https://github.com/stegra05/lectern/issues/193)).

## Decision

Native is a system screen: grey ground, white inset groups, one blue check on answers. Every
card has it; there is no setting and no choice before the first send. When Lectern's note type
is already in Anki, a send upgrades its stylesheet and templates (the `styling` and
`restyle` ports of Anki).

Rules the design keeps: shared templates, no JavaScript, bundled or system fonts, WCAG AA in
light and night, the ground set on `.card, .card.nightMode` (Anki's `body.nightMode` outranks
`.card` otherwise). How the gallery renders cards with Anki's own engine:
[`design/cards/NOTES.md`](../../design/cards/NOTES.md).

## Later, #193

| Design          | The idea                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Lecture colours | each card wears its lecture's colour as a pale tint (class `lec-NN`)     |
| Afterglow       | dark first, the answer is the only light, phosphor green                 |
| Vitrine         | a museum wall label, the answer as the object in a niche                 |
| Structure       | answer-shaped slots on dot grid paper                                    |
| Lamp            | an index card under a reading lamp, amber for what matters               |

Each is a stylesheet on the same templates, chosen in settings and offered once before the first
send. Structure and Lamp proved that one set of templates holds for very different looks.

## Why

Steffen wanted several designs as options and smart cards that adapt to the role. A second
design needs a choice, a setting and a restyle of cards already sent, which is more than the
base needs. Native matches the app's native look ([RFD 11](0011-app-shape.md)), so it is the
calm default.

## Given up

- **Corrector**: a marked exam paper with red handwriting. Rejected 2026-11-13.
- **Placard**: the answer as a full-bleed ultramarine field. Dropped 2026-11-14.
- **Lecture colours at full strength**: too loud during review. Softened, on the cards only.
- **The five other designs in v3.0.** Cut for the base, see Later.

## Open

- The `core` label and Structure's serif topic: [#129](https://github.com/stegra05/lectern/issues/129).
- Nobody has seen the design in a real Anki client yet: [#134](https://github.com/stegra05/lectern/issues/134).
