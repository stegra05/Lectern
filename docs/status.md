# Lectern v3: status

What is true today. Update it in the pull request that changes it. What comes next lives on the
roadmap board, not here. Last updated 2026-11-15.

## Design

Direction v2 is accepted as "right direction, needs polish", the look is fine. Decided: native
look per system with light and dark, lecture colours and a winding track, a full-width map that
never reshuffles, a slim bottom bar, one side panel for all details, mind maps as rings, six
card designs with Native as default, "Copy for chat" with cards as content. The themes view
comes after the base product. Every decision with its date: `design/DIRECTION.md`. The binding
kit: `design/KIT.md`. The canvas (https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE) is the
source of truth for screens and was edited by hand after its copy in `design/canvas/`.

## Engine

`packages/engine` runs the whole pipeline of `engine-decisions.md` on real slides: reading
slide by slide with pictures, a map of topics, concepts and facts, a worth score that decides
which facts get cards under the goal, cards written per fact and checked, an organisation check
that drops course administration, past exam questions turned into cards, and sending to a real
Anki. The `concept` preset is the working preset for concept courses; the three other kinds of
lecture still use the placeholder. 239 tests pass (2 skipped, live only).

On the 11 Entrepreneurship decks a run makes about 550 to 600 cards for under 20 cents on
`gpt-6-luna` with no hard-limit violation. Measured against Steffen's reference deck, coverage is
the gap, not form: many examined facts are only in pictures, videos and readings, or the card
tests another angle than the exam asks. Figures: `docs/history/engine-report.md`. How the code
works and where older documents lag it: `docs/architecture.md`.

## App

`packages/app` is the base prototype on the engine's one boundary: first run, courses, files and
goal, the run with the real phases, the result track, a lecture as rings, cards in the side
panel with changing, removing and writing a card, course details, settings with the card design
carousel, sending to Anki, in light and dark. 53 unit tests and one Playwright test from a new
course to its cards pass on the offline models. Screens: `docs/shots/`.

## Unverified

- The app's own send, edit and remove against a real Anki (the engine's ran against one; the
  app's only against the in-memory Anki).
- A real build started from inside the app (only from the engine's command line so far).
- Five of the six card checks are uncalibrated and only flag; only the organisation check acts.
- Packaging: the app reads the Anki templates from `packages/engine/anki` in the repository.

## Open with Steffen

- His personality references (calm craft, colour play in a native app, small delights) are not
  yet applied to any screen.
- Polish of the Direction v2 screens beyond the rings, which are done.
- The statistics content is a proposal he has not judged.

## Money

Paid runs only through the engine on OpenAI, within the 50 dollars he set for evals, each
preceded by its estimate. 70 cents were used by 2026-11-14; each later run states its cost in
`docs/history/engine-report.md`.
