# RFD 10 · Six card designs, Native by default

|           |                                                                    |
| --------- | ------------------------------------------------------------------ |
| **State** | decided                                                            |
| **Date**  | 2026-11-13 (two skins), 2026-11-14 (six designs, default)          |
| **Code**  | `packages/engine/anki/style-*.css`, gallery in `design/cards/`     |

> **In one breath.** One set of templates, six stylesheets. The student picks one in settings,
> is offered the choice once before the first send, and gets Native if they never choose.

## Decision

| Design          | Stylesheet            | The idea                                                                 |
| --------------- | --------------------- | ------------------------------------------------------------------------ |
| Native          | `style-native.css`    | a system screen: grey ground, white inset groups, one blue check on answers. **Default** |
| Lecture colours | `style-colours.css`   | each card wears its lecture's colour as a pale tint (class `lec-NN`)     |
| Afterglow       | `style-night.css`     | dark first, the answer is the only light, phosphor green                 |
| Vitrine         | `style-object.css`    | a museum wall label, the answer as the object in a niche                 |
| Structure       | `style-structure.css` | answer-shaped slots on dot grid paper                                    |
| Lamp            | `style-lamp.css`      | an index card under a reading lamp, amber for what matters               |

Rules every design keeps: shared templates, no JavaScript, bundled or system fonts, WCAG AA in
light and night, the ground set on `.card, .card.nightMode` (Anki's `body.nightMode` outranks
`.card` otherwise). The carousel in settings shows one design at a time on a card from the
student's own course. How the gallery renders cards with Anki's own engine:
[`design/cards/NOTES.md`](../../design/cards/NOTES.md).

## Why

Steffen wanted several designs as options and smart cards that adapt to the role. Structure and
Lamp proved one set of templates holds for very different looks. Native matches the app's
native look ([RFD 11](0011-app-shape.md)), so it is the calm default.

## Given up

- **Corrector**: a marked exam paper with red handwriting. Rejected 2026-11-13.
- **Placard**: the answer as a full-bleed ultramarine field. Dropped 2026-11-14.
- **Lecture colours at full strength**: too loud during review. Softened, on the cards only.

## Open

- The `core` label and Structure's serif topic: [#129](https://github.com/stegra05/lectern/issues/129).
- Nobody has seen the designs in a real Anki client yet: [#134](https://github.com/stegra05/lectern/issues/134).
