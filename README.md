# Lectern

**Turn lecture PDFs into Anki flashcards you can trust.**

Drop a lecture PDF on the desk. Lectern has Gemini read the whole document, build a
concept map, and then generate flashcards *agentically*: the model submits batches
through a tool call, every card passes a grounding gate (provenance + quality score),
and after each batch the model receives an updated **coverage ledger** — which pages,
concepts, and relations still lack cards — so it plans its own next batch. A final
quality pass rewrites weak cards. Review, edit, and send the deck to Anki via
AnkiConnect.

This is a from-scratch rebuild of the original Lectern (Python/FastAPI/PyWebView),
redesigned around what its history taught:

| Old (v1, `LecternApp/`) | New (this app) |
|---|---|
| Python backend + React frontend + SSE transport (29 commits fighting stream races) | No backend. The pipeline is TypeScript running in-process; state updates are direct store writes |
| Fixed batch loop, coverage hints pasted into each prompt | Agentic tool loop on the Gemini Interactions API (`submit_cards` / `finish_generation`, server-side conversation state) |
| Two event vocabularies, V1↔V2 translation, DDD layering (~40k LOC) | One event type, flat modules (~6k LOC incl. tests) |
| PyInstaller bundles, WebView2 babysitting, unsigned macOS builds | Tauri 2: ~10 MB dmg, signing-ready |
| Abstract coverage tiles | The illuminated filmstrip: real page thumbnails that light up as coverage arrives |

## Architecture

```
src/engine/          the pipeline (pure TS, no UI imports)
  gemini.ts          Interactions API client (upload, tool loop, retry)
  pipeline.ts        3 phases: concept map → agentic generation → reflection
  prompts.ts         prompt library (ported from v1, adapted for tools)
  geminiSchemas.ts   tool + structured-output schemas, tolerant parsers
  coverage.ts        coverage ledger, gap text, reflection card selection
  pacing.ts          deck sizing, batch guidance
  quality.ts         card quality rubric + grounding gate + normalization
  anki.ts            AnkiConnect client, note export, model resolution
  tags.ts            hierarchical tag templates
  pdf.ts             pdf.js metadata + page thumbnails
src/state/store.ts   single Zustand store; pipeline events land here directly
src/components/      the UI ("evening lecture hall" design system)
src-tauri/           Rust shell: keychain, CORS-free fetch, dialogs
```

The Gemini API key lives in the OS keychain under service `Lectern`, account
`gemini_api_key` — the same entry the original app used, so it carries over.

## Development

```bash
pnpm install
pnpm tauri dev        # full desktop app
pnpm dev              # browser-only dev mode (Tauri APIs fall back to web equivalents)

pnpm test             # unit tests
pnpm typecheck
GEMINI_API_KEY=... pnpm vitest run src/engine/gemini.smoke.test.ts    # live API smoke
GEMINI_API_KEY=... pnpm vitest run src/engine/pipeline.live.test.ts   # full E2E incl. Anki
```

In browser dev mode a `window.__lectern` handle exposes the store for debugging and
UI automation.

## Build

```bash
pnpm tauri build      # .app / .dmg on macOS
```

## Requirements

- [Anki](https://apps.ankiweb.net/) with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on
- A [Gemini API key](https://aistudio.google.com/apikey)
