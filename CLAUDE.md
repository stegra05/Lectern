# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lectern is a cross-platform desktop application that transforms PDF lecture slides into Anki flashcards using AI (Google Gemini). It parses PDFs, sends multimodal prompts to Gemini, and creates notes via AnkiConnect.

**Tech Stack:** Python backend (FastAPI), React/TypeScript frontend (Vite), PyWebView desktop wrapper.

## Development Commands

### Full Application (Desktop)
```bash
python gui/launcher.py
```

### Backend Only (for frontend development)
```bash
uvicorn gui.backend.main:app --reload --port 8000
```

### Frontend Only
```bash
cd gui/frontend && npm run dev   # http://localhost:5173
```

### Testing
```bash
pytest tests/                     # Python backend tests
cd gui/frontend && npm test       # Frontend tests (Vitest)
```

### Linting/Formatting
```bash
black .                           # Python formatter
cd gui/frontend && npm run lint   # ESLint
```

### Build Application Bundles
```bash
./scripts/build_app.sh            # macOS .app
./scripts/create_dmg.sh           # macOS .dmg
./scripts/build_linux.sh          # Linux
powershell scripts/build_windows.ps1  # Windows .exe
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Desktop Application (PyWebView)                        │
│  ┌─────────────────────┐  ┌─────────────────────────┐   │
│  │  Python Backend     │  │  React Frontend         │   │
│  │  (FastAPI + SSE)    │◄─┤  (TypeScript + Vite)    │   │
│  └─────────┬───────────┘  └─────────────────────────┘   │
│            │                                            │
│  ┌─────────▼───────────┐                               │
│  │  Lectern Service    │  ← Orchestrates generation    │
│  │  (lectern_service.py)│                              │
│  └─────────┬───────────┘                               │
│            │                                            │
│  ┌─────────▼───────────────────────────────────┐       │
│  │  lectern/                                    │       │
│  │  ├── ai_client.py    → Gemini API           │       │
│  │  ├── ai_prompts.py   → Prompt templates     │       │
│  │  ├── anki_connector.py → AnkiConnect API    │       │
│  │  └── utils/          → Export, history      │       │
│  └─────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### Key Directories
- `lectern/` — Core Python modules (AI client, Anki integration, prompts)
- `gui/backend/` — FastAPI server, API endpoints
- `gui/frontend/src/` — React components and API client
- `scripts/` — Platform-specific build scripts
- `tests/` — Python test suite

### Data Flow
1. PDF upload → Parse with pypdf
2. AI Session → Build concept map, generate cards via Gemini
3. Live Preview → User reviews/edits cards
4. Sync → Push to Anki via AnkiConnect API

## Code Style

### Python
- Type hints required (Python 3.9+ syntax: `list[str]` not `List[str]`)
- Google-style docstrings for complex functions
- Import order: stdlib → third-party → local
- Formatter: `black`

### TypeScript/React
- Functional components: `const Component: React.FC<Props> = (...) => ...`
- Tailwind: group utilities logically (layout → spacing → typography → color)
- State management: Zustand (global), React hooks (local)

## Philosophy

**"Craft over Speed"** — Prioritize readability, aesthetics, and safety.

## Critical Constraints

- **Never write to Anki's SQLite directly** — always use AnkiConnect API
- **API keys** stored in system keychain via `keyring`, never in config files or code
- **Logs location:** `~/Library/Application Support/Lectern/logs/` (macOS)
