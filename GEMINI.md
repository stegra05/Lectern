# Lectern — AI Agent Context

> **Version:** 1.2.0  
> **One-liner:** Desktop app that transforms PDF lecture slides into Anki flashcards via Google Gemini.

---

## Identity

Lectern is a **single-user desktop application** (not a web service). It ships as a native bundle via PyInstaller + PyWebView, wrapping a FastAPI backend and a React frontend in one window. The user opens a PDF, tunes a few knobs, and gets structured Anki cards pushed to their running Anki instance over the AnkiConnect API.

**Core philosophy:** Craft over speed. The interface is the product. Complexity is debt.

---

## Architecture Overview

```
User → PyWebView (native window)
         ├── React Frontend (Vite + TypeScript + Tailwind)
         │     ↕ HTTP / SSE
         └── FastAPI Backend (Python)
               ├── LecternService  — orchestrator
               ├── LecternAIClient — Gemini SDK wrapper
               ├── PDFParser       — pypdf + pypdfium2
               └── AnkiConnector   — REST client → AnkiConnect
```

**Data flow:** PDF → Parse (text + images) → Concept Map → Batched Card Generation → Reflection (QA) → Live Preview → Sync to Anki.

Real-time progress is streamed from backend to frontend via **Server-Sent Events (SSE)**.

---

## File Map

### Root-level Python (the engine)

| File | Purpose |
|------|---------|
| `lectern_service.py` | **Central orchestrator.** Owns the generation pipeline: parse → map → generate → reflect → export. Yields `ServiceEvent` objects consumed by any UI. |
| `ai_client.py` | Gemini SDK interface. Session management, multimodal prompting, structured output via Pydantic schemas. |
| `ai_common.py` | Shared AI utilities (token counting, response parsing). |
| `ai_prompts.py` | All prompt templates. Single source of truth for system/user prompts. |
| `ai_pacing.py` | Pacing calculator — adjusts batch size and density based on content type. |
| `ai_schemas.py` | Pydantic models for structured Gemini output (card schema). |
| `anki_connector.py` | AnkiConnect REST client. CRUD for notes, decks, models. |
| `pdf_parser.py` | PDF ingestion. Text + image extraction with page-level tracking. |
| `config.py` | All configuration. Priority: env var > `user_config.json` > defaults. |
| `version.py` | Single `__version__` string. Bumped by `release.sh`. |

### `utils/`

| File | Purpose |
|------|---------|
| `state.py` | Generation state persistence (checkpoint/resume). |
| `history.py` | Session history manager (`history.json`). |
| `note_export.py` | Card → AnkiConnect note format conversion. |
| `tags.py` | Hierarchical tag assembly (`Deck::SlideSet::Topic::Tag`). |
| `keychain_manager.py` | System keychain integration for API key storage. |
| `path_utils.py` | Cross-platform path resolution for logs/data. |

### `gui/`

| Path | Purpose |
|------|---------|
| `launcher.py` | Entry point. Starts Uvicorn + PyWebView. |
| `backend/main.py` | FastAPI app. All REST endpoints + SSE streaming. |
| `backend/service.py` | Thin wrapper bridging FastAPI routes to `LecternService`. |
| `backend/session.py` | In-memory session manager for concurrent generation tracking. |
| `backend/streaming.py` | SSE event formatting helpers. |

### `gui/frontend/src/`

| Path | Purpose |
|------|---------|
| `App.tsx` | Root component. Routing between views, theme, layout. |
| `store.ts` | **Zustand store.** All client state + action creators. Single source of truth. |
| `api.ts` | HTTP + SSE client. All backend calls live here. |
| `views/HomeView.tsx` | Dashboard — PDF upload, deck selection, settings. |
| `views/ProgressView.tsx` | Generation progress + card review/edit/sync. |
| `components/` | `SettingsModal`, `DeckSelector`, `FilePicker`, `HistoryModal`, `PhaseIndicator`, `OnboardingFlow`, `ConfirmModal`, `GlassCard`, `Skeleton`, `Toast`. |
| `hooks/` | `useAppState`, `useHistory`, `useToast`, `types`. |
| `index.css` | Design tokens (CSS custom properties) + Tailwind base. |

### Build & Release

| File | Purpose |
|------|---------|
| `Lectern.macos.spec` | PyInstaller spec for macOS (arm64 + x86_64). |
| `Lectern.windows.spec` | PyInstaller spec for Windows. |
| `Lectern.linux.spec` | PyInstaller spec for Linux. |
| `build_app.sh` | macOS build script (venv + frontend + PyInstaller). |
| `build_windows.ps1` | Windows build script. |
| `build_linux.sh` | Linux build script. |
| `create_dmg.sh` | Creates `.dmg` installer for macOS. |
| `release.sh` | Version bump → git tag → triggers CI. |
| `.github/workflows/build.yml` | CI/CD: cross-platform build + GitHub Release on tag push. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI | Google Gemini 3.0 Flash (multimodal, structured output) |
| Backend | Python 3.9+, FastAPI, Uvicorn |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 3, Framer Motion |
| State | Zustand (frontend), dataclasses + JSON (backend) |
| Desktop | PyWebView (Cocoa/WebKit on macOS) |
| PDF | pypdf + pypdfium2 |
| Security | `keyring` (system keychain for API keys) |
| Testing | pytest (backend), vitest + testing-library (frontend) |
| Packaging | PyInstaller |
| CI/CD | GitHub Actions |

---

## Design System

- **Fonts:** Manrope (sans), JetBrains Mono (mono)
- **Palette:** Zinc + Lime. Dark mode is the default. CSS custom properties via `--background`, `--surface`, `--primary`, `--secondary`, `--text-main`, `--text-muted`, `--border` in `index.css`.
- **Components:** Glassmorphism cards, Framer Motion transitions, lucide-react icons.
- **No Bootstrap blue.** `#007bff` and default Tailwind colors are banned.

---

## Development

### Prerequisites

- Python 3.9+
- Node.js 18+
- Anki with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) running

### Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd gui/frontend && npm install && cd ../..
```

### Run (Dev Mode)

```bash
python gui/launcher.py
```

This starts the FastAPI backend on `127.0.0.1:4173` and opens a native PyWebView window. For frontend-only development:

```bash
cd gui/frontend && npm run dev   # Vite dev server on :5173
```

### Testing

```bash
# Backend
pytest tests/

# Frontend
cd gui/frontend && npm test
```

---

## Conventions

### Python

- **Formatter:** `black`
- **Type hints:** Use `typing` module or modern syntax (`list[str]`) for 3.9+.
- **Docstrings:** Google-style for complex functions.
- **Imports:** stdlib → third-party → local.
- **Config access:** Always go through `config.py`, never read env vars directly in modules.
- **API key:** Never stored in files. Retrieved via `keyring` or env var.

### TypeScript / React

- **Functional components only.** `const Component: React.FC<Props> = (...) => ...`
- **State:** All state lives in the Zustand store (`store.ts`). No prop drilling for shared state.
- **Tailwind classes:** Group logically: layout → spacing → typography → color.
- **Naming:** PascalCase components, camelCase variables/functions.
- **Icons:** `lucide-react` exclusively.

### Git

```
<type>(<scope>): <description>   # 50 chars max, imperative, no period
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.  
Body explains *why*, not what. No "WIP" or past tense.

---

## Key Patterns

### Event-Driven Generation

The service layer yields `ServiceEvent` objects (type + message + data). The backend streams these as SSE to the frontend. The Zustand store processes them via `processGenerationEvent()`. This keeps the generation logic UI-agnostic.

### Pacing Strategy

Content density is auto-detected from chars/page:
- **Script** (>1500 chars/page): throttle by text volume
- **Normal** (400–1500): balanced
- **Slides** (<400): page-count based

The user controls a `density_target` slider (default 1.5 cards/slide) that the pacing system respects.

### Concept Map → Batched Generation → Reflection

1. **Concept Map:** First AI call builds a knowledge graph of the PDF content.
2. **Generation Loop:** Cards are generated in batches with an avoid-list to prevent duplicates.
3. **Reflection:** A QA pass critiques and improves the generated cards.

### Session & State Persistence

- `utils/state.py` saves generation checkpoints for resume support.
- `utils/history.py` manages `history.json` for session history.
- `session.py` tracks in-memory runtime state for concurrent sessions.

### Hierarchical Tags

All cards get tags in 4-level format: `Deck::SlideSet::Topic::Tag`.

---

## Safety Rules

1. **Never write to Anki's SQLite directly.** All operations go through AnkiConnect REST API.
2. **API keys live in the system keychain** (`keyring`), never in config files or git.
3. **PyInstaller specs include `pypdfium2` as a directory** (not a single file) to preserve its dynamic library structure.

---

## Common Pitfalls

- The `ai_schemas.py` Pydantic model uses a **list of key-value pairs** for card fields (not a dict) to satisfy Gemini's structured output constraint against `additionalProperties`.
- `pypdfium2` requires special handling in PyInstaller — its `.dylib`/`.so` must be bundled as a directory, not collected as data files.
- The frontend expects SSE events with specific `type` strings. Adding a new event type requires updating both `EventType` in `lectern_service.py` and `processGenerationEvent()` in `store.ts`.
- `config.py` loads at import time. Use `_get_config()` for values that should respect the priority chain (env > user_config.json > default).

---

## Evolution & Lessons (from History)

This section captures critical "tribal knowledge" and architectural decisions derived from past development cycles and bug fixes.

### AI & Gemini SDK

1.  **Schema Constraints:** Gemini 3.0 Flash (and earlier) can fail with `additionalProperties: false` errors when using dynamic keys in a dictionary. We use a **list of key-value pairs** (e.g., `[{name: "Front", value: "..."}]`) in `response_schema` and convert back to a dictionary in Python for reliability.
2.  **Token Counting Hang:** Never pass a `GenerateContentConfig` that includes a `system_instruction` to `client.models.count_tokens`. This causes silent hangs or API errors. Always strip the config for token counting.
3.  **Multimodal context:** Even if `skip_images` is true, we now track `image_count` per page. This gives the AI context about how "visual" a slide is, preventing it from hallucinating text on a diagram-heavy page.
4.  **JSON Escaping:** Avoid manual JSON escape logic. Rely on Gemini's `response_mime_type: "application/json"` and strict `response_schema` to handle structural escaping.
5.  **Thinking Models:** Gemini 3 Flash supports `thinking_config`. We use a "low" thinking level by default to balance reasoning depth with latency.

### Packaging & Distribution (PyInstaller)

6.  **PDFium Binary Cache:** `pypdfium2` requires its dynamic libraries (`.dylib`, `.so`, `.dll`) to be in a specific directory structure. In PyInstaller `.spec` files, always bundle the package as a directory, not as individual data files, to avoid `KERN_INVALID_ADDRESS` crashes.
7.  **Hidden Imports:** Root-level modules like `ai_client` and `pdf_parser` often need to be explicitly listed in `hiddenimports` if they aren't caught by PyInstaller's static analysis (especially when running via a script wrapper).
8.  **Spec File Tracking:** Never gitignore `.spec` files. They are static and critical for cross-platform CI/CD builds (macOS, Windows, Linux).

### Generation Logic

9.  **Reflection Pipeline:** Reflection is the "quality pass" that critiques and improves cards. It is considered a mandatory system feature; user-facing toggles to disable it are being removed to ensure output quality.
10. **Dynamic Reflection Rounds:** Instead of a fixed count, we use dynamic logic (e.g., 2 rounds for short PDFs, 1 for long ones) to manage the token budget without sacrificing quality on smaller sets.
11. **Pacing Modes:** The system auto-detects between **Script** (>1500 chars/page), **Normal**, and **Slides** mode. Each has a different density heuristic (chars-per-card vs cards-per-page).
12. **Deck Naming:** We deferred complex AI-powered deck pattern detection in favor of simple semantic extraction from the initial **Concept Map** response.
13. **Hierarchical Tagging:** All cards follow the `Deck::SlideSet::Topic::Tag` format. This ensures clean organization in Anki's sidebar.
14. **Avoid List:** Each generation batch includes an "avoid list" of fronts from the previous batch to prevent the AI from repeating the same concepts in different batches.

### Frontend & Store

15. **Zustand Persistence:** Critical settings (source type, density target) are persisted to `localStorage` via the store to maintain state across app restarts.
16. **SSE Event Processing:** The frontend logic in `store.ts` must be the single source of truth for processing SSE events. New backend event types require a corresponding handler in `processGenerationEvent`.
17. **CORS Origins:** `FRONTEND_ORIGINS` in `config.py` must include both `localhost:5173` (Vite dev) and `localhost:4173` (Production server) to prevent API blocks.

### Testing & Quality

18. **Coverage Targets:** The project aims for **85%+ backend** and **90%+ frontend** test coverage. Mocking `AnkiConnect` and Gemini API responses is the standard pattern for sustainable tests.
19. **Snapshot Testing:** GUI components (like `SettingsModal`) are tested via Vitest snapshots and state checks to ensure UI logic doesn't drift.
20. **Monolith Audit:** `lectern_service.py` is identified as a monolith. Future work involves extracting `cost_estimation` and cleaning up speculative media-upload logic.

---

## Technical Debt & Backlog

- **Multi-Document Input:** Requested but deferred due to token budget and UX complexity.
- **Resume System:** The GUI currently generates a new session ID for every run, making the "resume from checkpoint" logic potentially unreachable.
- **Media Output:** The schema supports images in cards (`media` field), but Gemini rarely outputs them with current prompts.

---

## Documentation Pointers

| Document | Path |
|----------|------|
| Architecture (detailed) | `docs/ARCHITECTURE.md` |
| Contributing guide | `CONTRIBUTING.md` |
| Release process | `RELEASING.md` |
| Frontend README | `gui/frontend/README.md` |
| Code audit | `audit/README.md` |
| Environment example | `.env.example` |
