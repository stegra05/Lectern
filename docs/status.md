# Lectern v3: status

What is true today. Update it in the pull request that changes it. What comes next lives on the
[roadmap board](https://github.com/users/stegra05/projects/3), not here. Last updated 2026-11-16.

## Design

The binding kit is `design/KIT.md`. The look is native per system, with light and dark, lecture
colours and a winding track, a full-width map that never reshuffles, a slim bottom bar, one side
panel for all details and mind maps as rings. Cards come in one design, Native. The card gallery
is `design/cards/gallery.html`, built by `design/cards/build.py`; the app icon is made by
`design/icon/export.sh`.

## Engine

`packages/engine` runs the whole pipeline on real slides: reading slide by slide with pictures,
a map of topics, concepts and facts, a kind and a worth score for every fact, the worth deciding
which facts get cards under the goal, cards written per fact and checked, an organisation check
that drops course administration, exact twins dropped, past exam questions turned into cards, and
sending to a real Anki. One preset, `CONCEPT`, serves every course. How the code works:
`docs/architecture.md`.

Engine tests: 217 pass, 2 skipped (live only, `LECTERN_LIVE=1`).

## App

`packages/app` is the base prototype on the engine's one boundary: first run, courses, files and
goal, the run with the real phases, the result track, a lecture as rings, cards in the side
panel with changing, removing and writing a card, course details, settings with the OpenAI key,
sending to Anki, past exam papers added in the course setup, in light and dark. 44 unit tests and one Playwright test from a new course to
its cards pass on the offline models. `pnpm --filter @lectern/app shots` takes pictures of the
screens into `out/shots`.

## Unverified

- The app's own send, edit and remove against a real Anki (the engine's ran against one; the
  app's only against the in-memory Anki).
- A real build started from inside the app (only from the engine's command line so far).
- Past papers added after a course's lectures are built change no card already made; they count
  only for lectures built later. Answers the model wrote are not checked against the readings.
- The exam step has run on one course; Grundlagen Datenbanken (8 papers) is untested.
- Packaging: the app reads the Anki templates from `packages/engine/anki` in the repository.

## Not built

Each is an issue on the roadmap board: more card designs (#193), presets for other kinds of
course (#194), Copy for chat (#195), card slots stored in `cards.yaml` (#196), calibrating
further checks (#105), typed answers (#128).
