# RFD 3 · One engine, one boundary, a course is a folder

|           |                                                                                  |
| --------- | -------------------------------------------------------------------------------- |
| **State** | decided                                                                          |
| **Date**  | 2026-11-13, card files 2026-11-14                                                |
| **Code**  | `packages/engine/src/api.ts`, `packages/app/src/shared/contract.ts`, `course.ts` |

> **In one breath.** A headless TypeScript engine does all the work, the Electron app talks to
> it through one API-shaped door, and everything a course knows sits in plain files you can
> open in an editor.

## Decision

- **A headless engine.** Reading documents, gates, roles, deck building and schedule maths are
  a TypeScript package with no interface code. It runs in the evals, from the command line,
  inside the app, and later on a server. Storage, network, PDF and Anki access are passed in.
- **One boundary.** The app reaches the engine only through `api.ts`, mirrored in the app's
  `contract.ts`. Moving to a website means swapping the in-app channel for HTTP. PDFs cross it
  as `Uint8Array`. An HTTP boundary decides its own encoding when there is one.
- **Electron as the shell.** The engine runs in Node, the same runtime as the evals, and
  Playwright drives both the interface and the packaged app.
- **A course is a folder of plain files.** No database.

| File                       | Holds                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| `course.json`              | lectures built, goal. Written last, so a half-built lecture never counts |
| `lectures/NN/cards.yaml`   | the accepted cards of one lecture                                        |
| `lectures/NN/lecture.json` | the map, slides left out with reasons, dropped cards                     |
| `decisions.json`           | the decisions shown to the student, written by code from facts           |
| `runs/NNN.json`            | model, preset, goal, calls, tokens, estimate, cost, phase durations      |
| `anki.json`                | which cards are in Anki                                                  |
| `exams.json`               | questions read from past exams                                           |

- **A lecture keeps its number forever** and is never rebuilt once it has a folder. Adding a
  lecture leaves earlier files byte for byte untouched.
- **Card ids** are `<lecture>-<concept>-<role>-<n>`, fixed before a word is written. A reworded
  card keeps its id, its place in the file and its Anki note.
- **Courses live in the app's data folder**, which needs no permission prompt. The API key is
  sealed with Electron `safeStorage`.

## Why

v1 failed on packaging and a split between a server and a webview. v2 ran everything in the
webview with a thin Rust shell. One engine with one boundary keeps the evals, the CLI and the
app on the same code, and plain files keep every run inspectable.

## Given up

- **One JSON file per card.** One readable YAML per lecture instead, like Steffen's study
  kits (his decision 10). The YAML holds field HTML, so it reads less like the kits than he
  pictured. Plain slots instead: [#196](https://github.com/stegra05/lectern/issues/196).
- **Courses in the Documents folder.** It triggered a permission prompt.
- **Reading v2's keychain entry** for the key.
