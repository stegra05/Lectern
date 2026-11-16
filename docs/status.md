# Lectern v3: status

What is true today. Update it in the pull request that changes it. What comes next lives on the
[roadmap board](https://github.com/users/stegra05/projects/3), not here. Last updated 2026-11-17.

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
that drops course administration, twins dropped (the same words in the same order), past exam questions turned into cards, and
sending to a real Anki. One preset, `CONCEPT`, serves every course. How the code works:
`docs/architecture.md`.

Each lecture is saved as soon as its cards are checked, so a stopped run keeps the lectures it
finished and building again pays only for the rest. Any failure of a build stops its model calls
at once, and the run record counts the calls that were under way.

`cards.yaml` holds each card as plain-text slots and where it comes from; one function builds the
field HTML, at send and for the preview. A course built before this is built again. The cost cap
counts calls in flight at their estimate, so a run cannot start a call that would pass it; a hard
limit on the reply of one call is open as [#303](https://github.com/stegra05/lectern/issues/303).
Commands that write to one course run one after the other, and an edit during a build is refused.
A PDF that cannot be read (password or damaged) is named with the reason and left out, and the
rest of the course builds. Concept ids keep letters of any script and tell C, C++ and C# apart. A
cloze gap keeps its place in the sentence. A refused, failed or rejected model call is worded in
plain words. The command line honours `LECTERN_FAKE=1` like the app and is tested on the offline
models.

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
Entrepreneurship papers three builds of v3 of 2026-11-16 hold 46.0%, 51.2% and 48.5% of the
marks (mean 48.6), a build of 2026-11-15 with cards from the older papers 43.8%, and a build
from slides only 31.3%. Builds of the same code differ by several points, so a change counts
only above about 6 points with three builds a side. `bench.ts gate` gives one verdict on a change:
better only above that bar and with the deck no bigger, the answers no longer and the build
no costlier. The papers of 2022 to 2024 are a dev set to tune on, the four newest the test set
([RFD 14](rfd/0014-the-quality-bar.md)). `blind.ts` draws the blind sample against the reference
deck and scores the answers.

Engine tests: 390 pass, 2 skipped (live only, `LECTERN_LIVE=1`).

## App

`packages/app` is the base prototype on the engine's one boundary: first run, courses, files and
goal, the run with the real phases, the result track, a lecture as rings, cards in the side
panel with changing, removing and writing a card, course details with changing the goal and
deleting the course, settings with the OpenAI key,
sending to Anki, past exam papers added in the course setup, in light and dark. Formulas are
typeset in the card preview, and long courses fit on the course card. The app can be used with the
keyboard from a new course to a changed card. 104 unit tests and 6 Playwright tests in 5 spec
files (the course from a new course to its cards in Anki, a double click on Make my cards, a
formula card, the keyboard, a map drag) pass on the offline models; 8 more, which take pictures,
run only with `LECTERN_SHOTS`. `pnpm --filter @lectern/app shots` takes pictures of the
screens into `out/shots`. `pnpm --filter @lectern/app package` builds an installer with the Anki
note type files inside it; the macOS one, opened from its dmg on this Mac, reached the
first-run screen and found its templates. A `v3.*` tag builds macOS, Windows and Linux installers into a
draft prerelease ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).

A whole course folder, dropped or chosen in the course setup, is sorted into lectures and past
exams; the threshold of the sort was measured on one folder. The setup panel lists the rest as
left out, adds a left-out file by hand, and moves a file without cards between lectures and past
exams or takes it out of the course again. A file that cannot be read is named in the panel with
what to do.

A course can be deleted, which leaves its deck in Anki, and its goal changed for the lectures
added later; renaming a course waits for
[#334](https://github.com/stegra05/lectern/issues/334). Closing the window during a build or send
only hides it on macOS. Quitting then asks first and stops the command at a safe point, so a cut
build keeps its run record and a cut send keeps its record of notes.

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
  ([#264](https://github.com/stegra05/lectern/issues/264)). It exists for one course.
- The dev baseline (three builds of v3 on the 14 papers before 2022: 48.5%, 47.7% and 55.2% of
  the dev marks, mean 50.5) has not been read on the test papers
  ([#270](https://github.com/stegra05/lectern/issues/270)). No change has passed the gate yet.
- The sort of added files is measured on one folder only, the Entrepreneurship folder its rules
  were shaped on: 43 of 45 files the model read on the right shelf at every threshold from 0.3
  to 0.9, all 36 lectures and exams in, 2 other files let in as sure answers. Nothing is held
  out; other courses and other languages are unmeasured. A file let in wrongly is taken out by
  hand while it has no cards.
- No change of the run of 2026-11-16 was sent to a real Anki; the tests use an Anki in memory.
- Since the cards are stored as slots, the lead-in highlight of a cloze list is gone (about one
  cloze list in ten had one), and courses built before must be built again.
- The hidden window on macOS during a build has been tried by hand only; no committed test covers
  it, as CI runs Linux.

## Not built

Each is an issue on the roadmap board: a hard limit on the cost of one call (#303), renaming a
course (#334), more card designs (#193), presets for other kinds of
course (#194), Copy for chat (#195), calibrating further checks (#105), typed answers (#128).
