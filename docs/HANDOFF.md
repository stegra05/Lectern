# Lectern v3: hand-off

Written 2026-11-14 for the next session. Branch `v3`, local only, nothing pushed.

## Read first, in this order

1. `docs/brief.md`: the product, architecture and scope.
2. `design/DIRECTION.md`: every design decision Steffen made, with dates and reasons.
3. `design/KIT.md`: the binding design kit (tokens, lecture colours, frame, map, cards).
4. `docs/engine-decisions.md`: his engine decisions, including how cards are created.
5. `docs/engine-report.md` and `docs/engine-plan.md`: what the engine can do today.
6. `docs/prototype-report.md` and `packages/app/README.md`: what the app can do today.

## Where things are

| Thing | Place |
|---|---|
| Design canvas (the source of truth for screens) | https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE |
| A copy of every canvas file | `design/canvas/project/` |
| Screens to build | canvas page "Direction v2", files `V2*.dc.html` |
| Card system: templates, six stylesheets, field contract | `design/cards/` (`FIELDS.md`, `anki/`) |
| Brief for designers of canvas screens | `design/V2-BRIEF.md` |
| Personality references | `design/personality/moodboard.html` |
| Engine | `packages/engine` |
| App (Electron) | `packages/app`, start with `pnpm --filter @lectern/app start` |
| Pictures of every base screen, light and dark | `docs/shots/` |
| The real run's course and log (not in git) | `eval-results/v3-courses/` |
| Superseded explorations, local only, not in git | `design/archive/` |
| v2 app, still the shipping product on `main` | `src/`, `src-tauri/` |

Steffen edited the canvas by hand after the last publish. Before changing any canvas file, read
it back from the canvas. The copy in `design/canvas/project/` may be older than the canvas.

## State

**Design.** Direction v2 is accepted as "right direction, needs polish", look is fine. Decided:
native look per system with light and dark, lecture colours and a winding track, a full-width
map that never reshuffles, a slim bottom bar, one side panel for all details, mind maps as
rings, six card designs with Native as default, "Copy for chat" with cards as content. Themes
view comes after the base product.

**Engine.** Milestones 1 and 2 are done and committed (engine code up to `3d408f8`): 158 tests
pass, typecheck and lint clean. The engine runs the seven steps of "How cards are created" with
one placeholder preset, has commands for the interface (`courses`, `course`, `cards`, `slide`,
`create`, `add`, `estimate`, `build`, `outline`) and offline models for interface tests. The
first real runs happened on 2026-11-14: the 11 Entrepreneurship decks became 596 cards for
16.7 cents on `gpt-6-luna`, with no card over a hard limit. The content is not good enough yet:
course administration gets cards, and some cards are thin. Figures and findings are in
`docs/engine-report.md`, section "First real runs". About 70 cents of the 50 dollars are used.

**App.** The base prototype is done and committed (app code up to `99ff4ab`): an Electron app
on the engine's one boundary, with first run, courses, files and goal, the run with the real
phases, the result track, a lecture as rings, cards in the side panel, course details and
settings with the card design carousel, in light and dark. 53 unit tests and one Playwright
test from a new course to its cards pass on the offline models. It was checked on the real
Entrepreneurship course. Sending to Anki is built (the card design offered once before the
first send, then only new cards with each later send). The engine's send ran against his real
Anki with 94 cards; the app's send has only run on an Anki in memory:
`docs/engine-report.md`, section "Sending to Anki". Changing, removing and writing a
card is built in the side panel and tested end to end on the offline models (section
"Changing single cards"). Not built yet: themes. A real build has only been started from the engine's command line,
never from inside the app.
Details and what is unverified: `docs/prototype-report.md`.

## Next steps

1. **Quality of the cards**, all decided in `engine-decisions.md`: the four lecture profiles as
   drafts for Steffen's approval, the concept course first; calibration of the decision checks
   (a strong model labels a few hundred Entrepreneurship examples, he spot-checks about thirty);
   a blind comparison of a run against his reference deck, the measure of success in the brief.
2. **Keeping course administration out of the cards.** The largest visible defect of the first
   real runs. Open with Steffen: a calibrated slide label, a rule in the preset, or both.
3. **The app after the prototype:** a send, an edit and a removal from inside the app against a
   real Anki (the engine's own have run against it), and a real build started from inside
   the app.
4. **Then:** evals on the two extra courses.

Paid runs: only the engine session starts them (agreed between the engine and the prototype
session on 2026-11-14), on OpenAI only, within the 50 dollars.

## Open with Steffen

- His pick of personality references was: calm craft, colour play in a native app, small
  delights. Not yet applied to any screen.
- Polish of the Direction v2 screens: he has not said what exactly needs polish beyond the
  rings, which are done.
- Statistics content is a proposal he has not judged.

## Rules that held up

- Design work goes to Opus subagents, research and extraction to Haiku subagents.
- Shared brief files in the repo, short agent prompts.
- Headless Chrome only under a kill timer: `perl -e 'alarm 30; exec @ARGV' <chrome> ...`.
- Scan every canvas file before publishing: one `support.js` line, no classes, no double curly
  braces, no external links.
- He answers best through the question tool with concrete options, and uses free text for nuance.
- Never push, never spend money, never delete untracked work without asking.
