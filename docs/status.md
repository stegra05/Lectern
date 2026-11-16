# Lectern v3: status

What is true today. Update it in the pull request that changes it. What comes next lives on the
[roadmap board](https://github.com/users/stegra05/projects/3), not here. Last updated 2026-11-16.

## Design

The binding kit is `design/KIT.md`. The look is native per system, with light and dark, lecture
colours and a winding track, a full-width map that never reshuffles, a slim bottom bar, one side
panel for all details and mind maps as rings. Cards come in one design, Native. The card gallery
is `design/cards/gallery.html`, built by `design/cards/build.py`; the app icon is made by
`design/icon/export.sh`. The decisions behind all of it are the RFDs in `docs/rfd/`, indexed in
`docs/README.md`.

## Engine

`packages/engine` runs the whole pipeline on real slides: reading slide by slide with pictures,
a map of topics, concepts and facts, a kind and a worth score for every fact, the worth deciding
which facts get cards under the goal, cards written per fact and checked, an organisation check
that drops course administration, exact twins dropped, past exam questions turned into cards, and
sending to a real Anki. One preset, `CONCEPT`, serves every course. How the code works:
`docs/architecture.md`.

Each lecture is saved as soon as its cards are checked, so a stopped run keeps the lectures it
finished and building again pays only for the rest.

On the 11 Entrepreneurship decks with 18 past papers a build took 35 minutes four calls at a
time and lecture after lecture. Measured on the code before v3's cuts
([#199](https://github.com/stegra05/lectern/issues/199)): with the calls of all lectures in one
queue, pictures sent once as files, pacing to the key's tokens a minute and the faster tier for
the maps, about 11 minutes; with up to three cards of a concept a writing call, each seeing only
its own slides' pictures, 6.4 to 7.1 minutes for about 39 cents. On v3 itself, a run took 6.3
minutes for 42 cents and 661 cards. The map of the lectures, one after the other, is now most of
the time.

The eval (`packages/engine/eval`) scores a deck two ways: on the marks of past papers its build
never saw (`bench.ts`), and against Steffen's reference deck (`refdeck.ts`). On the four newest
Entrepreneurship papers a build of 2026-11-15 with cards from the older papers holds 43.8% of
the marks, a build from slides only 31.3% ([RFD 14](rfd/0014-the-quality-bar.md)).

Engine tests: 249 pass, 2 skipped (live only, `LECTERN_LIVE=1`).

## App

`packages/app` is the base prototype on the engine's one boundary: first run, courses, files and
goal, the run with the real phases, the result track, a lecture as rings, cards in the side
panel with changing, removing and writing a card, course details, settings with the OpenAI key,
sending to Anki, past exam papers added in the course setup, in light and dark. 44 unit tests and one Playwright test from a new course to
its cards pass on the offline models. `pnpm --filter @lectern/app shots` takes pictures of the
screens into `out/shots`. `pnpm --filter @lectern/app package` builds an installer with the Anki
note type files inside it; the macOS one, opened from its dmg on this Mac, reached the
first-run screen and found its templates. A `v3.*` tag builds macOS, Windows and Linux installers into a
draft prerelease ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).

On 2026-11-15 the app ran once for real: a build of one lecture (Session 8, 19 slides, goal
"a good grade") on `gpt-6-luna` made 19 cards in 73 seconds for 1.9 cents (estimate 1.9). Sent
from the app to a real Anki (a throwaway Anki data folder), all 19 arrived in one subdeck; a
changed card changed the same note in Anki, a removed card left Anki and the record, and an own
card arrived tagged `::own`.

## Unverified

- Past papers added after a course's lectures are built change no card already made; they count
  only for lectures built later. Answers the model wrote are not checked against the readings.
- The exam step has run on one course; Grundlagen Datenbanken (8 papers) is untested.
- The exam rubric is model-made and no person has checked it
  ([#264](https://github.com/stegra05/lectern/issues/264)). It exists for one course, and v3 as
  it stands today has not been scored on it: both scored builds are from 2026-11-15.
- The release workflow has not run: only a pushed `v3.*` tag tests it. The Windows and Linux
  installers have not been built. The macOS installer is arm64 only and signed ad hoc, so a
  downloaded copy is quarantined by Gatekeeper; nothing is signed or notarised
  ([#191](https://github.com/stegra05/lectern/issues/191)).

## Not built

Each is an issue on the roadmap board: more card designs (#193), presets for other kinds of
course (#194), Copy for chat (#195), card slots stored in `cards.yaml` (#196), calibrating
further checks (#105), typed answers (#128).
