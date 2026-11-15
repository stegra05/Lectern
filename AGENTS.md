# Lectern v3

A course of lecture PDFs in, a trustworthy Anki deck out, made by cheap models. This is the
long-lived `v3` branch; `main` still holds the shipping v2 app and merges with v3 at v3.0.

## Layout

| Path | What |
|---|---|
| `packages/engine` | headless TypeScript engine: reads a course folder, makes and checks cards, sends to Anki. Its one boundary is `src/api.ts` |
| `packages/app` | Electron shell; talks to the engine only through that boundary (`src/shared/contract.ts`) |
| `docs/` | product brief, architecture, engine decisions, reports |
| `design/` | design kit (`KIT.md`, binding), decisions (`DIRECTION.md`), card system (`cards/`), canvas copies |

Read before changing behaviour: `docs/brief.md`, then `docs/engine-decisions.md` for engine
work or `design/KIT.md` for interface work.

## Commands

```sh
pnpm install
pnpm check                                   # lint, format check, typecheck, unit tests
pnpm test:e2e                                # app end to end on the offline models
LECTERN_FAKE=1 pnpm --filter @lectern/app start   # the app, offline models, Anki in memory
pnpm --filter @lectern/engine cli estimate <course folder>
```

`pnpm check` must pass before a commit is pushed. CI runs the same plus the e2e test.

## Working rules

- One concern per pull request, under 1,000 changed lines (whole-file deletions and renames
  aside). Larger work is a stack: `gh stack init --base v3 <branch>`, `gh stack add <branch>`
  per layer, `gh stack rebase` when the base moves, `gh stack submit` to open the PRs.
- Commit messages: `type(scope): what changed`, types `feat fix docs build ci chore test`,
  scopes `engine app design`.
- Never push, open or merge a pull request, or spend money without Steffen's yes in his words.
- Paid model runs only through the engine (`cli build`), on OpenAI, each preceded by its
  estimate. Keys live in the macOS keychain (service `Lectern`); pass them by environment
  variable, never write them to a file.
- Tests run on the offline models (`LECTERN_FAKE=1`, the engine's fakes). Nothing in a test
  reaches a real model, a real Anki or the student's courses.
- Simplest code that meets the current need; no backward compatibility, no speculative
  options. Established libraries over hand-rolled code.
- Prose and interface copy: plain words, no em-dashes.
- The design canvas (https://claude.ai/artifact/E4ZxyLc4DdB7HK3CgoQ1XE) was edited by hand.
  Read a screen back from the canvas before trusting its copy in `design/canvas/`.
