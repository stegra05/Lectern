# Lectern v3: status

What is true today. Update it in the pull request that changes it. Why things are this way: the
[RFDs](README.md). What comes next: the
[roadmap board](https://github.com/users/stegra05/projects/3). Last updated 2026-11-15.

## Engine

`packages/engine` runs the whole pipeline on real slides ([RFD 4](rfd/0004-lecture-to-cards.md)):
reading slide by slide with pictures, a map of topics, concepts and facts, a worth score that
picks facts under the goal, cards written per fact and gated, an organisation check that drops
course administration, past exam questions turned into cards, and sending to a real Anki. The
`concept` preset is the working preset; the three other kinds of course use the placeholder.
240 tests pass (2 skipped, live only).

On the 11 Entrepreneurship decks with 18 past papers a run makes about 630 cards for about 55
cents on `gpt-6-luna` in about 35 minutes, with no hard-limit violation. A card answers 34 of the
52 questions of four newer papers the engine never saw, and covers 246 of the 636 notes of
Steffen's reference deck (39%). Form is fine; coverage is the gap
([RFD 14](rfd/0014-the-quality-bar.md), [RFD 8](rfd/0008-past-exams.md)). How the code works: [`architecture.md`](architecture.md).

## App

`packages/app` is the base prototype on the engine's one boundary: first run, courses, files and
goal, the run with the real phases, the course track, a lecture as rings, cards in the side
panel with changing, removing and writing a card, course details, settings with the card design
carousel, Copy for chat, past exam papers added in the course setup, sending to Anki, in light
and dark. 53 unit tests and one Playwright
test from a new course to its cards pass on the offline models. Screens: [`shots/`](shots/).

## Design

Direction v2 is accepted as "right direction, needs polish" ([RFD 11](rfd/0011-app-shape.md)).
Six card designs, Native by default ([RFD 10](rfd/0010-card-designs.md)). The binding kit is
[`design/KIT.md`](../design/KIT.md); the canvas is the source of truth for screens.

## Unverified

- The app's own build, send, edit and remove against a real Anki and a real key
  ([#112](https://github.com/stegra05/lectern/issues/112)).
- Five of the six card checks are uncalibrated and only flag
  ([#105](https://github.com/stegra05/lectern/issues/105)).
- The cards in a real Anki client, on desktop or phone
  ([#134](https://github.com/stegra05/lectern/issues/134)).
- Packaging: the app reads the Anki templates from `packages/engine/anki` in the repository
  ([#113](https://github.com/stegra05/lectern/issues/113)).
- The OpenAI prices against a bill ([RFD 6](rfd/0006-money.md)).
- Past exams have run on one course; model-written answers are not checked against the
  readings ([RFD 8](rfd/0008-past-exams.md)).

## Money

Paid runs only through the engine on OpenAI, within the 50 dollars for evals, each preceded by
its estimate ([RFD 6](rfd/0006-money.md)). Each run records its cost in its course folder.
