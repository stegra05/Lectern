# Lectern — Agent Context

> **Identity:** Lectern is a desktop application that transforms PDFs into Anki flashcards using Google Gemini AI.
> **Tech Stack:** Python (FastAPI), React (TypeScript/Vite/Zustand), PyWebView, pypdf, AnkiConnect.

---

## The Four Laws of Lectern

Every change to this codebase must follow these principles:

1. **Safety Net Before Surgery:** Never refactor without a verification mechanism (write integration tests first).
2. **Strict Separation of Concerns:** No God components. Isolate UI, state, orchestration, and clients.
3. **Single Source of Truth:** Do not duplicate prompt logic, schemas, configurations, or event definitions.
4. **Boy Scout Rule:** Make incremental improvements. Do not halt progress for big-bang rewrites.

---

## Architecture Summary

```
┌─────────────────────────────────────────────┐
│  PyWebView Desktop Shell                    │
│  ┌─────────────┐    ┌───────────────────┐  │
│  │  React UI   │◄──►│  FastAPI Backend  │  │
│  │  (Vite)     │    │  (SSE events)     │  │
│  └─────────────┘    └───────────────────┘  │
└─────────────────────────────────────────────┘
         │                    │
    AnkiConnect           Gemini AI
```

### Key Paths

| Path | Purpose |
|------|---------|
| `lectern/` | Core engine (AI client, PDF parsing, Anki integration, V2 app orchestration) |
| `gui/backend/` | FastAPI routers, session management, SSE emission |
| `gui/frontend/` | React app with Zustand state, Tailwind styling |
| `tests/` | Python unit tests mirroring package structure |
| `gui/frontend/e2e/` | Playwright E2E tests |
| `docs/` | Technical documentation |

---

## Code Patterns

### Backend (Python/FastAPI)

- **Routers:** `gui/backend/routers/` + `gui/backend/interface_v2/routers/` — `anki.py`, `history.py`, `system.py`, `generation_v2.py`, `history_v2.py`
- **Models:** Pydantic for all data structures
- **Dependency Injection:** FastAPI's `Depends()` for services
- **Events:** V2 API events from `lectern/application/dto.py` and domain events from `lectern/domain/generation/events.py`

### Frontend (React/TypeScript)

- **State:** Zustand store in `gui/frontend/src/store.ts` — no prop drilling
- **Components:** Strictly functional components
- **Styling:** Tailwind CSS + Framer Motion
- **API:** `api.ts` for REST calls, SSE for real-time updates

### Events (V2 System)

Generation transport is V2-only. Backend emits `ApiEventV2` envelopes (`event_version: 2`) and frontend maps them in `gui/frontend/src/logic/generation.ts`.

If you add a new V2 event type, update all of:
- `ApiEventType` in `lectern/application/dto.py`
- translator mapping in `lectern/application/translators/event_translator.py`
- frontend schema in `gui/frontend/src/schemas/sse-v2.ts`
- frontend handling in `gui/frontend/src/logic/generation.ts`

### Type Safety

- **Python:** Type hints with modern syntax (`list[str]` not `List[str]`)
- **TypeScript:** Strict mode, no `any` types
- **API:** OpenAPI spec generates typed client via `npm run generate-api`

---

## Testing Guidance

### Backend Tests

```bash
pytest tests/                                   # All tests
pytest tests/application/test_generation_app_service_v2.py -v  # V2 app service
pytest tests/interface/test_generation_v2_router.py -v         # V2 transport
pytest -k "anki"                               # Pattern match
```

- Tests mirror package structure (`tests/test_ai_client.py` → `lectern/ai_client.py`)
- `conftest.py` provides fixtures for mocking external services (Gemini, AnkiConnect)

### Frontend Tests

```bash
cd gui/frontend && npm test      # Vitest unit tests
```

### E2E Tests

```bash
cd gui/frontend && npm run test:e2e              # All E2E tests
cd gui/frontend && npm run test:e2e:critical     # Critical path only
cd gui/frontend && npm run test:e2e:integrated   # Integrated smoke tests
```

Test files in `gui/frontend/e2e/tests/`:
- `00-integrated-smoke.spec.ts` — Basic app load
- `01-configuration.setup.spec.ts` — Config flow
- `02-pdf-upload-generation.spec.ts` — Upload and generation
- `03-card-review-sync.spec.ts` — Review and Anki sync

### Coverage Expectations

- New features require tests
- Refactors require existing tests to pass or be updated first (Law #1)
- Use `conftest.py` fixtures for mocking external APIs

---

## Git Workflow

### Branching

- Feature branches from `main`
- Use descriptive names: `feat/anki-sync`, `fix/pdf-parsing`, `refactor/state-management`

### Commits

Follow conventional commits:
- `feat:` — New features
- `fix:` — Bug fixes
- `refactor:` — Code restructuring without behavior change
- `test:` — Adding/updating tests
- `docs:` — Documentation only
- `chore:` — Build, CI, tooling

### Pull Requests

- Target `main` branch
- CI must pass before merge
- Request review via `superpowers:requesting-code-review` skill
- Address feedback via `superpowers:receiving-code-review` skill

---

## CI/CD Context

### Pipeline Stages

```
lint → e2e-tests → integrated-smoke → build → release (on tags)
```

### What Blocks PRs

| Check | Description |
|-------|-------------|
| ESLint | Frontend linting errors |
| TypeScript | Type errors in `tsconfig.app.json` |
| Critical E2E | Tests in `01-*` and `02-*` files |
| Integrated Smoke | Backend + frontend integration test |
| API Drift | `src/generated/api.ts` out of sync with backend |

### Release Process

1. Ensure clean working directory and passing tests
2. Run: `./scripts/release.sh [major|minor|patch]`
3. Script bumps version, creates git tag
4. GitHub Actions builds for macOS, Windows, Linux
5. Tag push triggers automatic release with artifacts

### Key CI Files

| File | Purpose |
|------|---------|
| `.github/workflows/build.yml` | Main CI pipeline |
| `scripts/build_app.sh` | macOS build |
| `scripts/build_windows.ps1` | Windows build |
| `scripts/build_linux.sh` | Linux build |
| `scripts/release.sh` | Release orchestrator |

---

## Skills Guidance

Superpowers skills provide structured workflows. **Always check if a skill applies before starting work.**

### When to Invoke Skills

| Situation | Skill |
|-----------|-------|
| Creating new features | `superpowers:brainstorming` first, then `superpowers:writing-plans` |
| Fixing bugs/test failures | `superpowers:systematic-debugging` |
| Implementing features | `superpowers:test-driven-development` |
| Multiple independent tasks | `superpowers:dispatching-parallel-agents` |
| Work complete, need review | `superpowers:requesting-code-review` |
| Received code review feedback | `superpowers:receiving-code-review` |
| Ready to merge/finish | `superpowers:finishing-a-development-branch` |
| Verifying work is complete | `superpowers:verification-before-completion` |

### Pattern

1. **Before any action:** Check if a skill applies (even 1% chance → invoke it)
2. **Skills override defaults:** Follow skill instructions exactly
3. **Process first, implementation second:** Use brainstorming/debugging before domain skills

---

## Documentation Index

| File | Content |
|------|---------|
| `docs/ARCHITECTURE.md` | System diagrams, data flow, component details |
| `docs/AI_PIPELINE.md` | Gemini phases, concept mapping, pacing strategy |
| `docs/FRONTEND.md` | React, Zustand, SSE architecture |
| `docs/BACKEND.md` | FastAPI, sessions, Anki integration |
| `docs/DESIGN_SYSTEM.md` | UI philosophy, styling rules |
| `docs/DEVELOPMENT.md` | Setup, build scripts, test commands |

---

## Quick Reference

### Running the App

```bash
python gui/launcher.py              # Full desktop app
uvicorn gui.backend.main:app --reload --port 4173  # Backend only
cd gui/frontend && npm run dev      # Frontend only
```

### Common Commands

```bash
pytest tests/                       # Backend tests
cd gui/frontend && npm test         # Frontend tests
cd gui/frontend && npm run lint     # Lint frontend
cd gui/frontend && npm run generate-api  # Regenerate API client
./scripts/build_app.sh              # Build macOS app
./scripts/release.sh patch          # Create patch release
```
