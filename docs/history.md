# The rebuild story

Lectern 2 is a from-scratch rewrite of the original Lectern, a Python/FastAPI/
PyWebView desktop app (preserved on the
[`v1`](https://github.com/stegra05/Lectern/tree/v1) branch). The rewrite was
designed around what v1's history taught:

| v1 (Python) | v2 (this app) |
|---|---|
| Python backend + React frontend + SSE transport (29 commits fighting stream races) | No backend. The pipeline is TypeScript running in-process; state updates are direct store writes |
| Fixed batch loop, coverage hints pasted into each prompt | Agentic tool loop on the Gemini Interactions API (`submit_cards` / `finish_generation`, server-side conversation state) |
| Two event vocabularies, V1↔V2 translation, DDD layering (~40k LOC) | One event type, flat modules (~6k LOC incl. tests) |
| PyInstaller bundles, WebView2 babysitting, unsigned macOS builds | Tauri 2: ~10 MB bundle, signing-ready |
| Abstract coverage tiles | The illuminated filmstrip: real page thumbnails that light up as coverage arrives |

## What survived the rewrite

The crown jewels of v1 carried over as ideas, re-implemented clean:

- **Coverage-ledger-steered generation.** After every batch the model is told
  which pages, concepts, and relations still lack cards, and plans its next batch
  accordingly.
- **The grounding gate.** No card enters the deck without provenance (source
  pages + concepts + excerpt) and a passing quality checklist.
- **The prompt library.** Rewritten concise for Gemini 3.5's agentic mode, but
  the hard-won renderer constraints and few-shot examples survived.

## What was deliberately dropped

- The backend. A local HTTP server + SSE stream between two processes on the same
  machine was the single largest source of bugs (split-brain state, stream races,
  reconnection logic). The pipeline now runs in the webview; a state update is a
  function call.
- The 23-weight quality rubric, replaced by a checklist gate: hard failures
  reject, soft issues flag the card for your attention.
- DDD layering and dual event vocabularies. One event type, flat modules.
