# Backend Architecture

The backend (`gui/backend/`) is a FastAPI application that serves the React frontend, streams generation events, and integrates with the AnkiConnect local server.

## Architecture Overview
- **API Framework:** FastAPI running on Uvicorn.
- **Desktop Wrapper:** PyWebView launches a native window (Cocoa/WebKit on macOS) that renders the FastAPI endpoints.

## Core Modules

### Routing (`gui/backend/routers/`)
- `anki.py`: Proxies requests to the local AnkiConnect instance.
- `generation.py`: Triggers AI pipeline and handles the SSE `/stream` endpoint.
- `system.py`: Configuration and environment checks.

### The Service Layer
The bridge between FastAPI and the AI engine is `lectern_service.py` (located in `lectern/`), which uses `phase_handlers.py` to manage discrete logic for each generation stage. This module owns the pipeline, calculates pacing, tracks state, and yields events. The backend's `service.py` acts as a thin wrapper to expose this orchestrator to the API routes.

### State & Session Management
- `gui/backend/session.py`: Tracks in-memory active runs and temp-file lifecycle.
- `lectern/utils/history.py` + `lectern/utils/database.py`: Persist session state/history in SQLite (`lectern.db`) for resume/history views.
- Startup recovery in `gui/backend/main.py` marks stale in-flight draft sessions as `interrupted` so crashed runs do not remain in a misleading generating phase.

### AnkiConnect Integration
- Never write to Anki's SQLite database directly.
- The `anki_connector.py` REST client issues CRUD operations via the AnkiConnect add-on port (`localhost:8765`).

### Security
API keys are never stored in the `.env` file or config JSON by default. They are injected via environment variables or loaded securely from the OS keychain using `utils/keychain_manager.py`.
