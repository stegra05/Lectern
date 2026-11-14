# Lectern v3: hand-off

Written 2026-11-14 for the next session. Branch `v3`, local only, nothing pushed.

## Read first, in this order

1. `docs/v3/brief.md`: the product, architecture and scope.
2. `design/v3/DIRECTION.md`: every design decision Steffen made, with dates and reasons.
3. `design/v3/KIT.md`: the binding design kit (tokens, lecture colours, frame, map, cards).
4. `docs/v3/engine-decisions.md`: his engine decisions, including how cards are created.
5. `docs/v3/engine-report.md` and `docs/v3/engine-plan.md`: what the engine can do today.

## Where things are

| Thing | Place |
|---|---|
| Design canvas (the source of truth for screens) | https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE |
| A copy of every canvas file | `design/v3/canvas/project/` |
| Screens to build | canvas page "Direction v2", files `V2*.dc.html` |
| Card system: templates, six stylesheets, field contract | `design/v3/cards/` (`FIELDS.md`, `anki/`) |
| Brief for designers of canvas screens | `design/v3/V2-BRIEF.md` |
| Personality references | `design/v3/personality/moodboard.html` |
| Engine | `packages/engine` |
| Superseded explorations, local only, not in git | `design/v3/archive/` |
| v2 app, still the shipping product on `main` | `src/`, `src-tauri/` |

Steffen edited the canvas by hand after the last publish. Before changing any canvas file, read
it back from the canvas. The copy in `design/v3/canvas/project/` may be older than the canvas.

## State

**Design.** Direction v2 is accepted as "right direction, needs polish", look is fine. Decided:
native look per system with light and dark, lecture colours and a winding track, a full-width
map that never reshuffles, a slim bottom bar, one side panel for all details, mind maps as
rings, six card designs with Native as default, "Copy for chat" with cards as content. Themes
view comes after the base product.

**Engine.** Milestone 1 is done and verified: 94 tests pass, typecheck clean. It was built to
the first goal, before Steffen's decisions arrived. The engine session then started milestone 2
and was cut off by a usage limit, so `packages/engine` has uncommitted changes in progress
(Anthropic adapter removed, several files modified). Look at `git status` and `git diff` there
before doing anything, and finish or revert deliberately. Do not commit it blindly.

## Next steps

1. **Engine milestone 2**, as agreed: one YAML file per lecture and dropped cards with reasons;
   the OpenAI adapter and the decisions port (`POST /v1/decisions`); "code plans, model fills"
   with one placeholder preset; a first real run on Entrepreneurship with estimate and cap.
   Budget from Steffen, in his words: "up to 50 dollars, only openai. Have some credits there".
   Any other paid run needs his yes.
2. **The full prototype.** Scaffold the Electron app as `packages/app`, talking to the engine
   only through its one boundary. Build the base screens from the canvas: first run, courses,
   files on the track with the goal, the run with real phases, the result (track, lecture
   rings, side panel with cards), settings with the card carousel, sent. Leave out for the base:
   themes view, study plan, quiz, past exams, feedback loop.
3. **Then:** Anki delivery through the add-on, the four hand-written profiles (drafted for his
   approval), calibration data for the decision models (a strong model labels, he spot-checks
   about thirty), evals against the reference deck and on the two extra courses.

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
