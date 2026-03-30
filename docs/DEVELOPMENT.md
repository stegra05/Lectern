# Development Guide

## Philosophy
Lectern follows a strict mandate of structural integrity. Every change to this codebase is governed by the four laws of our development philosophy:

1. **Safety Net Before Surgery:** Never refactor without a verification mechanism (integration tests).
2. **Strict Separation of Concerns:** No God components. Decouple UI, state, service, and external clients.
3. **Single Source of Truth:** No duplicated logic (prompts, schemas, config).
4. **Boy Scout Rule:** Incremental improvement, no big-bang rewrites.

## Setup

### Prerequisites
- Python 3.9+
- Node.js 18+
- [Anki](https://apps.ankiweb.net/) with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) installed and running.

### Python Environment
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Frontend Environment
```bash
cd gui/frontend
npm install
```

## Running the Application

### Full Application (Desktop Mode)
Starts the FastAPI backend and opens the native PyWebView window.
```bash
python gui/launcher.py
```

### Standalone Development
If you are developing the UI, it's faster to run the backend and frontend separately:
```bash
# Terminal 1: Backend
uvicorn gui.backend.main:app --reload --port 4173

# Terminal 2: Frontend
cd gui/frontend && npm run dev
```

## Testing

```bash
# Python Backend
pytest tests/

# React Frontend
cd gui/frontend && npm test
```

## Telemetry Measurement Workflow

Use persisted client telemetry (`state/telemetry.sqlite3`) to compare user-visible latency across releases and task complexity.

### Collect telemetry

Run regular app workflows (estimate + generation). Telemetry is sent to backend and persisted automatically:
- metric names include `estimate_total_duration` and `generation_total_duration`
- each entry includes complexity context (`card_count`, `total_pages`, `chars_per_page`, `model`, `build_version`, `build_channel`)

### Query summary APIs

```bash
curl "http://localhost:4173/metrics/summary?metric_name=generation_total_duration&window_hours=168"
curl "http://localhost:4173/metrics/patterns?metric_name=generation_total_duration&window_hours=168"
```

Use these endpoints to identify worst p95 segments by model, build, and complexity buckets.

### Generate local report

```bash
python scripts/perf_report.py --window-hours 168
```

Optional custom DB path:

```bash
python scripts/perf_report.py --db-path "/path/to/telemetry.sqlite3" --window-hours 168
```

### Compare release builds

1. Capture telemetry for each build channel/version under comparable user flows.
2. Run `scripts/perf_report.py` for the same `window-hours`.
3. Compare p95 rows for:
   - `estimate_total_duration`
   - `generation_total_duration`
   - `generation_time_to_first_card`
4. Check complexity buckets (`card_count_bucket`) to validate whether regressions are tied to specific workload profiles.

## Code Style

### Python
- Formatter: `black`
- Type hints: Modern syntax (`list[str]` not `typing.List[str]`).
- Config: Always access through `config.py`.

### React / TypeScript
- Formatter/Linter: `prettier` and `eslint`.
- Components: Strictly functional components.
- State: Global state MUST live in the Zustand `store.ts`.

## Build & Release Process

Everything is automated via scripts and GitHub Actions.

### Building Locally
```bash
./scripts/build_app.sh            # macOS .app
./scripts/create_dmg.sh           # macOS .dmg
./scripts/build_linux.sh          # Linux
powershell scripts/build_windows.ps1  # Windows .exe
```

### Releasing a New Version
1. Ensure your working directory is clean and tests pass.
2. Run the release orchestrator:
   ```bash
   ./scripts/release.sh [major|minor|patch]
   ```
3. Monitor GitHub Actions. It will create a GitHub Release with the appropriate `.dmg`, `.exe`, and `.tar.gz` artifacts.
