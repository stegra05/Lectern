# Lectern v3

A course of lecture PDFs in, a trustworthy Anki deck out, made by cheap models.

The student creates a course, drops in one PDF per lecture, states a goal, and Lectern writes
atomic cards with subdecks and tags, shows each card next to its slide, and sends the deck to
Anki. The method lives in tooling and presets; the model only fills slots.

This is the long-lived `v3` branch. The shipping v2 app lives on `main` until v3.0 replaces it.
Where v3 stands today: [`docs/status.md`](docs/status.md).

## Quick start

Needs Node 22 or newer and pnpm 11.

```sh
pnpm install
LECTERN_FAKE=1 pnpm --filter @lectern/app start   # the app on offline models, nothing is paid
pnpm check                                       # lint, format, typecheck, unit tests
pnpm test:e2e                                    # the app end to end
```

Without `LECTERN_FAKE` the app asks for an OpenAI key on first run.

## Layout

| Path              | What                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `packages/engine` | headless engine: reads a course folder, makes and checks cards, sends them to Anki |
| `packages/app`    | Electron app around the engine, through its one boundary                           |
| `docs/`           | what the product is, how it is built, what is decided                              |
| `design/`         | design kit, design decisions, card field contract, canvas copies                   |

## Docs

| Document                                                           | Read it for                                     |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| [`docs/brief.md`](docs/brief.md)                                   | the product, its scope and why v3 exists        |
| [`docs/status.md`](docs/status.md)                                 | what works today and what is unverified         |
| [`docs/architecture.md`](docs/architecture.md)                     | how the code works, written from the code       |
| [`docs/engine-decisions.md`](docs/engine-decisions.md)             | Steffen's decisions on how cards are made       |
| [`docs/engine-profile-concept.md`](docs/engine-profile-concept.md) | the preset for concept courses                  |
| [`design/KIT.md`](design/KIT.md)                                   | the binding design kit                          |
| [`design/DIRECTION.md`](design/DIRECTION.md)                       | every design decision, with dates and reasons   |
| [`docs/history/`](docs/history/)                                   | goals, plans and reports of finished milestones |

How to work on it: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT, see [`LICENSE`](LICENSE).
