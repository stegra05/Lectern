# Lectern v3: report on the base prototype

Written 2026-11-14. Goal: `GOAL.md`. Branch `v3`, local commits only, nothing pushed, no pull
request. Verified at commit `99ff4ab` in a clean checkout.

## Verdict

The base prototype works end to end: a course of lecture PDFs goes from the first run screen to
finished cards in the side panel, in an Electron app that talks to the engine only through its
one boundary. All eight criteria are met, with three things to know first:

1. **I did not write the engine code.** Another session was working in `packages/engine` when I
   started. Steffen told me to coordinate with it, so it finished milestone 2 and I built the
   app. I checked its work in a clean checkout and ran the real build.
2. **Two real runs happened instead of one.** My run and the engine session's run of the same
   decks crossed. Total spent on OpenAI today, both sessions: about 70 cents of the 50 dollars.
3. **The cards are not trustworthy yet.** The pipeline holds every hard limit, but course
   administration gets cards and the map is split too finely. That is the engine's open work
   (profiles, calibration), which the goal excluded.

## Criteria

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | No stray uncommitted work in the engine, tests and typecheck pass | Met | The cut-off work was finished and committed by the engine session (`f5d004a`). `pnpm --filter @lectern/engine test`: 162 passed, 2 skipped (live). `pnpm --filter @lectern/engine typecheck`: clean. The engine session keeps working there on its next task, so the folder has its fresh edits again |
| 2 | Engine milestone 2 per `engine-decisions.md` | Met | Table below |
| 3 | One real run on the 11 Entrepreneurship decks within the cap | Met | Section "The real run" |
| 4 | `packages/app` exists, one command starts it | Met | `pnpm --filter @lectern/app start` |
| 5 | Base screens work with real engine output, light and dark | Met | 26 pictures from the real course, section "Screens" |
| 6 | Playwright test from creating a course to cards in the side panel | Met | `pnpm --filter @lectern/app test:e2e`: 1 passed |
| 7 | Pictures of every base screen in light and dark, each looked at | Met | `docs/v3/shots/`, 13 screens times 2 |
| 8 | This report | Met | |

## Test results

Run in a clean checkout of `99ff4ab`, so the engine session's unfinished edits do not count.

| Command | Result |
|---|---|
| `pnpm --filter @lectern/engine test` | 162 passed, 2 skipped (the live OpenAI tests), 6 files |
| `pnpm --filter @lectern/engine typecheck` | clean |
| `pnpm --filter @lectern/app test` | 53 passed, 3 files (map layouts 40, card templates 13) |
| `pnpm --filter @lectern/app typecheck` | clean |
| `pnpm --filter @lectern/app test:e2e` | 1 passed in 2.3 s, 1 skipped (the picture walk, which runs only on request) |
| `pnpm exec eslint packages/app packages/engine` | clean |

The Playwright test passed three times in a row on the offline models at 80 ms per call.

## What was built

### Engine milestone 2 (by the engine session, commits `f5d004a` to `3d408f8`)

| Item | Where |
|---|---|
| One YAML file per lecture | `lectures/NN/cards.yaml`, `src/course.ts` |
| Dropped cards with concept and reason | `lecture.json`, field `dropped` |
| OpenAI adapter | `src/adapters/openai.ts` (Responses API, strict JSON schema) |
| One decisions port with a scripted fake | `DecisionsPort` in `src/ports.ts`, `client.decisions` in the adapter, `src/adapters/fake.ts` |
| Kinds of slide and of fact through that port | `src/decide.ts` (`SLIDE_KINDS`, `FACT_KINDS`) |
| Code plans, the model fills one form per card | `src/plan.ts`, `src/writer.ts` |
| Split step for cards that are too long | `split` in `src/writer.ts` |
| Estimate before the run and a hard cap | `src/cost.ts`, `src/build.ts` |
| One placeholder preset, marked as such | `src/presets.ts` (`placeholder`) |
| Offline pipeline test covering all of it | `test/pipeline.test.ts` |

On my request it also added what an interface needs, in the same boundary: `courses`, `course`,
`cards`, `slide`, `create`, `add` (PDFs as base64, so the boundary stays plain JSON), and
offline models that turn any PDF text into a small course without a script. Its own account:
`docs/v3/engine-report.md`.

### The app (`packages/app`, commits `623209a` to `99ff4ab`, about 8,800 lines with tests and CSS)

- **Shell.** Electron 45.3.1 with electron-vite. The engine runs in the main process. One
  channel carries commands and events. The key is sealed with the system's protected storage
  and never reaches the interface. `LECTERN_FAKE=1` runs on the offline models.
- **Interface.** React and plain CSS, one store, the kit as CSS variables for light and dark.
  The contract uses the engine's own types, so a change of the boundary fails the typecheck.
- **Screens.** First run (provider and key), courses, the empty course, files on the track
  with the goal question and the estimate, the run with the engine's four phases, the result
  on the track, a lecture as rings, cards in the side panel with the slide picture, course
  details with decisions and statistics, settings with the card design carousel (six designs
  through the real Anki templates) and the provider. "Copy for chat" is in as well.
- **Beyond the canvas.** The side panel shows what the unmeasured checks noticed ("Worth a
  look: copies a long run of slide text"), which makes the content defects visible.

How to run it is in `packages/app/README.md`.

## The real run

11 Entrepreneurship slide decks (356 slides), goal "top grade", `gpt-6-luna` for writing and
for decisions, engine at `7332526`, through the engine's command line with the key from the
keychain in that command's environment. Log with the estimate first:
`eval-results/v3-courses/entrepreneurship-run-1.log` (ignored by git, like the course folder).

| Figure | Value |
|---|---|
| Estimate before the run | 712 cards, $0.186, cap $0.558 |
| Cards made | 658 |
| Cards dropped | 7 |
| Limit violations | 0, checked by a script of my own over every card |
| Cards flagged by unmeasured checks | 38 |
| Cost | $0.484, which is 2.6 times the estimate and under the cap |
| Duration | 19.4 minutes (read 13 s, map 590 s, write 479 s, check 83 s) |
| Size | 57 topics, 295 concepts, 752 model calls, 1,424 decisions |
| Left out | 31 slides: 11 title, 1 agenda, 19 without a testable fact |

Dropped cards and reasons: Big Five meta-analysis (key term not marked), The 18-hour CD and
Teece model (answer not one short term), Analogical reasoning and Fail early and often (a label
over 4 words), Sources of external funds (a list item over 8 words), de Havilland Comet 1 (front
of 21 words).

Kinds of card: definition 195, fill the list 137, contrast 111, case 93, reverse 89, drawing
18, chain 14, code 1. Average front 10.5 words, average answer 8.5 words.

The limits I checked: front at most 20 words, answer at most 25 words and 2 bullets, no yes or
no opener, cloze at most 5 deletions of at most 8 words without hints, extra at most 40 words.

**The second run.** The engine session got Steffen's yes in its own session and started the
same 11 decks before it read my message that mine was running. Its run, on the engine with its
prompt cache fix: 596 cards, 5 dropped, $0.167. Two runs of the same decks differ by up to
about 20 percent per lecture. We agreed afterwards that only the engine session starts paid
runs.

## Screens

`docs/v3/shots/`, each in light and dark, 1100 by 720, taken by `pnpm --filter @lectern/app
shots` from the running app. Screens 06 to 13 show the course of the real run. Screens 03 to 05
show the real 11 PDFs added through the app (about 120 MB, one of 70 MB) and a run on the
offline models, because a second real run only for a picture would have cost money.

01 first run, 02 courses, 03 empty course, 04 files and goal, 05 run midway, 06 result track,
07 decisions, 08 statistics, 09 lecture as rings, 10 a concept's cards, 11 and 12 card design
carousel, 13 provider. I looked at all 26.

## What failed along the way

- **The map broke on real data.** The canvas samples have 7 concepts in a lecture. Real
  lectures have up to 51, with long names. Pills overlapped, labels ran under the panel and
  off the window. Fixed: labels and pills are now placed at every zoom so nothing overlaps or
  leaves the free area, and a concept without room shows as its dot until zoom, hover or
  selection.
- **Two paid runs**, see above.
- **The real run cost 2.6 times its estimate.** The engine paid full price for the lecture on
  every card call. The engine session fixed the prompt cache after its first deck.
- **A store bug** hid the failure of a run right after showing it. Fixed.
- **The picture walk** took four runs until every picture was right: a locator on the
  lowercase course name, a picture taken in the middle of the first run animation, and the
  window changing size between pictures. Tests now keep the window off the screen at a fixed
  size.
- **Lint**: 37 errors after the builders finished (store actions declared as methods, React
  compiler rules in the map). All fixed.
- **Engine and app out of step once.** The engine added a field to a run, and the app's design
  fixture did not have it, so the typecheck failed for one commit. Fixed in `99ff4ab`.

No criterion was given up on.

## Unverified

- **A real build started from inside the app.** The real run went through the engine's command
  line. The app has only run builds on the offline models. Saving a real key (the check with
  OpenAI and sealing it) was never exercised either, because I do not type a real key into a
  field. The engine code underneath is the same, the wiring around it is untested with money.
- **Windows and Linux.** Only macOS was run.
- **Drag and drop of PDFs.** The test uses the file chooser. The drop path shares its code
  after the drop event.
- **"Copy for chat"**, zoom and pan, leaving a course during a run, and adding a lecture to a
  finished course in the app: checked by hand or by the builders' scripts, not by a committed
  test. The engine tests cover the adding itself.
- **A packaged app.** There is no installer. `start` builds and runs from the folder.
- **Formulas in the card preview.** The preview runs no scripts, so MathJax does not render.
- **Courses with more than about 24 lectures** on the track.

## Known gaps and defects

- **Content.** Admin and recap slides get cards ("At what time does the class start?"), 295
  concepts for 356 slides is too fine, and lecture titles are cut at 32 characters. Engine
  work, reported to the engine session and now first on its list.
- **The run screen marks the lecture being worked on, but not the finished ones.** Topics
  and card counts of a lecture appear only when the whole run has ended, because the engine
  saves nothing before that. The canvas shows them arriving lecture by lecture.
- **Dense lectures stay cramped.** Topic pills are cut short ("Support net..."), and in a
  51 concept lecture about half the concepts show as dots only at the fitted zoom.
- **Not built, by scope:** sending to Anki (the flag stop always says "Not sent yet" and there
  is no send button), themes (the switch is shown and disabled), study plan, quiz, past exams,
  the feedback loop. Editing, removing and adding a card are in the brief's base product but
  not in this goal, so they are missing too.
- **In fake mode** the settings say the key is stored, while it is only kept in memory.

## After the first version of this report

The engine session closed two gaps I had reported, and I used both the same day (engine
`73347f8`):

- **The card estimate** is fitted to the two real runs: the files screen now says "About 683
  cards" for the 11 decks instead of 1068.
- **Progress names the lecture.** During a run the stop of the lecture being worked on is
  marked on the map ("Writing its cards"), and the run panel and the bottom bar name it.
  Pictures 04 and 05 are retaken.

Checked on the working tree after that change: app typecheck and lint clean, 53 unit tests and
the Playwright test pass. Not rerun in a clean checkout, because the engine session has
unfinished edits in `packages/engine` again.

## Decisions I took

- **Coordinate instead of taking over the engine.** The on-disk goal said to ask Steffen when
  another session works in the engine, and he wrote "Communicate with the other session
  running".
- **The boundary carries PDFs as base64.** The interface has no file paths, and the boundary
  should survive a move to HTTP. Cost: a 70 MB PDF travels as a 93 MB string. It worked.
- **Courses live in the app's data folder**, not in Documents, to avoid a permission prompt.
  Open to change.
- **The key is sealed with Electron's safeStorage** and kept in the app's data folder. The
  keychain entry of the v2 app is not read.
- **No dead controls.** Where the engine or the scope gives nothing, the element is left out
  (no send button, no minutes estimate, no per-lecture progress).
- **Electron 45.3.1 and Playwright 1.65.0**, one release behind the newest, so pnpm's release
  age gate stays on.
- **A design fixture stays in the repo** (`dev/fixture.ts`, `scripts/shot.mjs`): states such as
  a run midway or a failed run are hard to reach otherwise. It is typed against the engine's
  boundary and never part of the app.

## Proposed next milestone

**"Into Anki, with cards worth sending."** Two tracks that meet at the end:

1. **Engine: quality** (the engine session has started): the concept course profile for
   Steffen's approval, calibration of the checks so admin and recap slides are left out, then
   the blind comparison against the reference deck.
2. **App: the rest of the base product.** Sending through the add-on with the card design
   offered once before the first send, editing, removing and adding a card, a real build
   started from the app with a real key, and committed tests for adding a lecture later.
   Alongside: lectures that show their topics as soon as their cards are written, which
   needs the engine to save or report a lecture before the whole run ends.

Done when the 11 lecture course goes from the app into Anki, Steffen prefers or cannot tell
apart a sample of its cards from his reference deck, and adding lecture 12 creates only new
cards. That is the "done when" of `brief.md`.
