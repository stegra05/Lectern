<div align="center">

# Lectern

**Turn lecture PDFs into Anki flashcards you can trust.**

[![CI](https://github.com/stegra05/Lectern/actions/workflows/ci.yml/badge.svg)](https://github.com/stegra05/Lectern/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/stegra05/Lectern?include_prereleases)](https://github.com/stegra05/Lectern/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

<img src="docs/screenshots/demo.gif" alt="Lectern generating a deck from a machine-learning lecture: the filmstrip lights up page by page as grounded cards stream in" width="840" />

</div>

Drop a lecture PDF on the desk. Lectern has Gemini read the whole document, build a
concept map, and generate flashcards **agentically** — the model plans its own
batches, and after each one it sees a coverage ledger of which pages and concepts
still lack cards. Every card must cite the pages it came from and pass a quality
gate before it enters your deck. Review, edit, and send to Anki in one click.

## Why not just paste slides into a chatbot?

Because you can't trust the output — and with 400 cards a semester, checking each
one by hand defeats the point. Lectern is built around verifiability:

- **Grounded cards.** Every card carries provenance: source pages, the concept it
  teaches, and a source excerpt. A grounding gate rejects cards that can't back
  themselves up — you see what was rejected and why.
- **Coverage you can see.** The filmstrip shows your actual slides and lights up
  as cards cover them. Gaps are visible at a glance, not discovered during the exam.
- **Check the source in place.** Click a card's page reference and the original
  slide opens next to it.
- **A quality pass at the end.** The model reviews the whole deck and rewrites weak
  cards — every edit passes the same gate.
- **Your data, your key.** No accounts, no server, no subscription. The app talks
  directly to the Gemini API with your key (stored in the OS keychain). A typical
  70-page lecture costs a few cents to ~$1 depending on deck size.

<div align="center">
<img src="docs/screenshots/review.png" alt="Reviewing the finished deck: serif flashcards with page references and topics, coverage stats, and a Send to Anki bar" width="840" />
<br/><br/>
<img src="docs/screenshots/slide-peek.png" alt="Slide peek: the original lecture slide opens next to the card that was generated from it" width="840" />
</div>

## Install

**[Download the latest release](https://github.com/stegra05/Lectern/releases/latest)**
— macOS (Apple Silicon & Intel), Windows, and Linux.

Or build from source:

```sh
git clone https://github.com/stegra05/Lectern.git
cd Lectern && pnpm install && pnpm tauri build
```

## Getting started

1. Install [Anki](https://apps.ankiweb.net/) and the
   [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on, and keep Anki
   running.
2. Get a free [Gemini API key](https://aistudio.google.com/apikey) and add it in
   Lectern's settings (⌘,). It is stored in your OS keychain, never on disk.
3. Drop a lecture PDF on the desk, name the target deck, and hit **Generate deck**.
4. Watch the filmstrip light up. When generation finishes, review and edit the
   cards — each one shows the pages it came from.
5. **Send to Anki.** Re-running a lecture updates existing notes instead of
   creating duplicates.

## How it works

```
PDF ──▶ concept map ──▶ agentic generation ──▶ quality pass ──▶ your review ──▶ Anki
        objectives,      Gemini submits card     whole-deck       edit, search,
        concepts,        batches via tool        review loop;     filter by page,
        relations,       calls; each batch is    every edit       peek at slides
        per page         gated + answered with   re-gated
                         a coverage ledger
```

The pipeline runs entirely in-process — there is no backend, no account, and
nothing leaves your machine except the calls to the Gemini API and to your local
Anki. The whole engine is ~6k lines of TypeScript including tests:

```
src/engine/          the pipeline (pure TS, no UI imports)
  pipeline.ts        three phases: concept map → agentic generation → reflection
  gemini.ts          Gemini Interactions API client (upload, tool loop, retry)
  coverage.ts        the coverage ledger the model steers by
  quality.ts         grounding gate: provenance + quality checklist
  anki.ts            AnkiConnect client, duplicate-safe sync
src/state/store.ts   one Zustand store; pipeline events land as direct writes
src/components/      the UI ("evening lecture hall" design system)
src-tauri/           thin Rust shell: keychain, CORS-free fetch, dialogs
```

## Development

```sh
pnpm install
pnpm tauri dev        # full desktop app
pnpm dev              # browser-only dev mode (Tauri APIs fall back to web equivalents)

pnpm test             # unit tests (offline)
pnpm typecheck
GEMINI_API_KEY=... pnpm vitest run src/engine/pipeline.live.test.ts   # live E2E incl. Anki
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup details and code layout.

## History

Lectern 2 is a from-scratch rebuild of a Python/FastAPI/PyWebView app that grew to
~40k lines before teaching its lessons. The rebuild story — what broke, what
survived, and why the whole thing is now 6k lines with no backend — is in
[docs/history.md](docs/history.md). The original lives on the
[`v1`](https://github.com/stegra05/Lectern/tree/v1) branch.

## License

[MIT](LICENSE) © Steffen Grabert
