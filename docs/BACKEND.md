# Backend Architecture

The backend (`gui/backend/`) is a FastAPI application that serves the React frontend, streams generation events, and integrates with the AnkiConnect local server.

## Architecture Overview
- **API Framework:** FastAPI running on Uvicorn.
- **Desktop Wrapper:** PyWebView launches a native window (Cocoa/WebKit on macOS) that renders the FastAPI endpoints.

## Core Modules

### Routing (`gui/backend/routers/` + `gui/backend/interface_v2/routers/`)
- `anki.py`: Proxies requests to the local AnkiConnect instance.
- `history.py`: Legacy history endpoints for existing UI screens.
- `system.py`: Configuration and environment checks.
- `generation_v2.py`: V2 generation transport (`POST /generate-v2`) with NDJSON envelopes.
- `history_v2.py`: V2 event/session history transport.

### Generation V2 Transport Contract (`/generate-v2`)
- Streams `ApiEventV2` envelopes as newline-delimited JSON (`application/x-ndjson`).
- Validates cursor input (`after_sequence_no >= 0`) and rejects cursor usage without `session_id`.
- Resume with cursor replays history first (`replay_stream`) and then continues live resume (`run_resume_stream`).
- Pre-stream domain failures map to HTTP status codes with structured error details.
- Post-stream failures emit a terminal `error_emitted` event because HTTP status is already fixed once streaming starts.

### The Service Layer (V2-only)
The bridge between FastAPI and the generation engine is `GenerationAppServiceImpl` in `lectern/application/generation_app_service.py`. Backend dependencies wire this service with concrete adapters (`lectern/infrastructure/*`) for PDF extraction, Gemini provider access, Anki export, runtime session coordination, and SQLite-backed event history.

### State & Session Management
- `gui/backend/session.py`: Tracks in-memory active runs and temp-file lifecycle.
- `lectern/infrastructure/persistence/history_repository_sqlite.py`: V2 event/session persistence in `history_v2.sqlite3`.
- `lectern/utils/history.py` + `lectern/utils/database.py`: Legacy history store still used by existing history screens.
- Startup recovery in `gui/backend/main.py` marks stale in-flight draft sessions as `interrupted` so crashed runs do not remain in a misleading generating phase.

### AnkiConnect Integration
- Never write to Anki's SQLite database directly.
- The `anki_connector.py` REST client issues CRUD operations via the AnkiConnect add-on port (`localhost:8765`).

### Security
API keys are never stored in the `.env` file or config JSON by default. They are injected via environment variables or loaded securely from the OS keychain using `utils/keychain_manager.py`.
