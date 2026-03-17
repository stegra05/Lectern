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
The bridge between FastAPI and the AI engine is `lectern_service.py` (located in `lectern/`). This module owns the pipeline, calculates pacing, tracks state, and yields events. The backend's `service.py` acts as a thin wrapper to expose this orchestrator to the API routes.

### State & Session Management
- `utils/state.py`: Manages the serialization of active generation sessions so they can be paused or resumed.
- `utils/history.py`: Stores a permanent record of past generations in `history.json`.

### AnkiConnect Integration
- Never write to Anki's SQLite database directly.
- The `anki_connector.py` REST client issues CRUD operations via the AnkiConnect add-on port (`localhost:8765`).

### Security
API keys are never stored in the `.env` file or config JSON by default. They are injected via environment variables or loaded securely from the OS keychain using `utils/keychain_manager.py`.
