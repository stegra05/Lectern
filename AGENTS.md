# Lectern v3

A course of lecture PDFs in, a trustworthy Anki deck out, made by cheap models. This is the
long-lived `v3` branch; `main` still holds the shipping v2 app and merges with v3 at v3.0.

## Layout

| Path | What |
|---|---|
| `packages/engine` | headless TypeScript engine: reads a course folder, makes and checks cards, sends to Anki. Its one boundary is `src/api.ts` |
| `packages/app` | Electron shell; talks to the engine only through that boundary (`src/shared/contract.ts`) |
| `docs/` | decisions as RFDs (`rfd/`), architecture from the code, status |
| `design/` | design kit (`KIT.md`, binding), card field contract and gallery (`cards/`), icon, mood board |

Read before changing behaviour: `docs/status.md` and RFD 1 (`docs/rfd/0001-the-product.md`),
then the RFDs on what you touch (index: `docs/README.md`), `docs/architecture.md` for how the
code works and `design/KIT.md` for interface work. A change that alters a decision updates its
RFD, and a change that alters what `docs/status.md` says updates it, in the same PR. Anything
still to do is an issue, never a note in a doc.

What comes next is on the roadmap board: one issue per piece of work, each with "Done when"
criteria, a type, Area, Size and, in the current release, a Priority; releases are milestones.
The `roadmap` skill in `.claude/skills/` says how to read and change it, and its `board.sh` does
the work. Start only issues from the Agent queue view (`board.sh view "Agent queue"`) and set
them to In progress; a Decision, a Verify or anything labelled `costs money` waits for Steffen's
yes. A PR names its issue with "Closes #N", which moves it to In review, and to Done on merge.

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
  per layer, `gh stack rebase` when the base moves, `gh stack submit` to open the PRs. The
  `gh-stack` skill in `.claude/skills/` has the non-interactive flags and recovery steps.
- Commit messages: `type(scope): what changed`, types `feat fix docs build ci chore test refactor`,
  scopes `engine app design`.
- Agents may push branches, open pull requests and merge them into `v3` once CI is green, every
  "Done when" line has evidence in the PR body and the diff was read by a session that did not
  write it. `main`, releases and spending money need Steffen's yes in his words.
- Paid model runs only through the engine (`cli build`), on OpenAI, each preceded by its
  estimate. Keys live in the macOS keychain (service `Lectern`, account `openai_api_key`; the
  service alone finds another provider's key); pass them by environment variable, never write
  them to a file.
- Tests run on the offline models (`LECTERN_FAKE=1`, the engine's fakes). Nothing in a test
  reaches a real model, a real Anki or the student's courses.
- A change that claims better cards is measured, not argued: the `exam-bench` skill in
  `.claude/skills/` has the procedure, and its gate gives the verdict (RFD 14).
- Simplest code that meets the current need; no backward compatibility, no speculative
  options. Established libraries over hand-rolled code.
- Prose and interface copy: plain words, no em-dashes.