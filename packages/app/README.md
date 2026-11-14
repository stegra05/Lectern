# @lectern/app

The Lectern v3 desktop app: an Electron shell around `@lectern/engine`. Design: `design/v3/KIT.md`
(binding) and the canvas frames in `design/v3/canvas/project/V2*.dc.html`.

## Commands

| What | Command |
|---|---|
| Start the app | `pnpm --filter @lectern/app start` |
| Start it on the offline models (no key, no cost) | `LECTERN_FAKE=1 pnpm --filter @lectern/app start` |
| Develop with reload | `pnpm --filter @lectern/app dev` |
| Unit tests | `pnpm --filter @lectern/app test` |
| End-to-end test (builds first, offline models) | `pnpm --filter @lectern/app test:e2e` |
| Pictures of every base screen into `docs/v3/shots/` | `pnpm --filter @lectern/app shots` |
| Typecheck | `pnpm --filter @lectern/app typecheck` |

Environment: `LECTERN_FAKE=1` (offline models), `LECTERN_FAKE_DELAY=<ms>` (each offline call
takes that long), `LECTERN_COURSES=<dir>` (where courses live), `LECTERN_DATA=<dir>` (settings
and the sealed key), `OPENAI_API_KEY` (wins over the stored key). For `shots`,
`LECTERN_SHOTS_COURSE=<course folder>` pictures a finished real course.

## How it is built

The interface talks to the engine only through the engine's one boundary: commands in, events
out, plain JSON, with the engine's own types (`src/shared/contract.ts`). The engine runs in the
main process. The shell adds only what an engine cannot do: the window, the sealed API key and
the chosen card design.

```
src/shared/contract.ts     the engine's commands and events, the shapes the screens read, the bridge
src/main/                  window, the channel for commands and events, engine ports, settings and key
src/preload/               window.lectern
src/renderer/src/
  store.ts                 the one store, and the only file that calls window.lectern.run
                           (two lazy loads aside: slide pictures and the outline for "Copy for chat")
  tokens.css               KIT.md as CSS variables, light and dark by the system
  ui/                      title bar, icons, the few shared controls
  map/                     the course track and a lecture as rings, pure layouts with tests
  course/                  the frame inside a course: bottom bar, side panel and its contents
  screens/                 first run, courses, settings
  cards/                   a card rendered through the real Anki templates in one of the six designs
  dev/fixture.ts           stand-in data for design work in a browser, never part of the app
e2e/                       the Playwright test and the walk that takes the pictures
scripts/shot.mjs           a picture of one fixture scenario, for design work
```

## Rules for changes

- `KIT.md` is binding: tokens, type sizes, radii, the frame, the lecture colours. Every colour
  comes from a variable in `tokens.css`, so light and dark both hold.
- Quiet native controls. No blob shapes, no left-border accents, no gradients, no emoji.
- Plain language, no em-dashes, and every error names the fix.
- Nothing that does not work: no dead buttons, no invented numbers. A figure the store does not
  hold is left out.
- A browser is only ever started under a kill timer.
