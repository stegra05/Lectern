# Contributing to Lectern

## The Philosophy

Lectern was vibe-coded to a working MVP. The mandate now is structural integrity without over-engineering. Read the **Development Philosophy** section in `GEMINI.md` for the four laws that govern every change to this codebase:

1. **Safety Net Before Surgery** — integration tests before refactoring
2. **Strict Separation of Concerns** — no God components
3. **Single Source of Truth** — no duplicated logic
4. **Boy Scout Rule** — incremental improvement, no big-bang rewrites

## Development Setup

### Python

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Frontend

```bash
cd gui/frontend && npm install
```

### Formatters

- Python: `black`
- TypeScript: `prettier` / `eslint`

## Workflow

1. Create your branch from `main`.
2. Write or confirm integration tests for any code you touch.
3. Ensure the test suite passes before opening a PR.
4. Make sure your code lints.

## Code Style

### Python

- **Type Hints:** `typing` module or modern `list[str]` syntax (3.9+).
- **Docstrings:** Google-style for complex functions.
- **Imports:** stdlib → third-party → local.

### TypeScript / React

- **Functional Components:** `const Component: React.FC<Props> = (...) => ...`
- **Tailwind:** Group utilities logically (layout → spacing → typography → color).
- **Naming:** PascalCase components, camelCase variables/functions.

## Testing

```bash
# Backend
pytest tests/

# Frontend
cd gui/frontend && npm test
```

## Reporting Bugs

Bugs are tracked as GitHub issues. A clear, minimal reproduction is worth a thousand words.
