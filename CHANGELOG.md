# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-03-17

### Added
- **Session Orchestration**: Introduced `SessionOrchestrator` to decouple generation logic from the service layer, enabling better session management and tracking.
- **State Synchronization**: Implemented a robust "Control Plane/Data Plane" sync protocol over SSE using `SnapshotTracker` to ensure client-server state consistency and eliminate "split-brain" issues.
- **Real-time Streaming**: Enhanced SSE event stream with granular phase-based progress tracking and delta updates for improved UI responsiveness.

### Changed
- Refactored `LecternService` to use `SessionOrchestrator` for all generation tasks.
- Improved frontend state management using Zustand slices for better modularity and performance.

### Removed
- Legacy synchronous generation loops in `LecternService`.
- Obsolete `pdf_utils.py` and redundant SSE events.

## [1.11.5] - 2026-03-16

### Added
- **Page Range Selection**: Added granular page/content selection to configuration, allowing users to specify exact PDF pages for processing.

### Fixed
- **UI Audit**: Fixed placeholder contrast in ConfigurationCard for WCAG compliance.
- **UI Audit**: Added border affordances to ghost input fields in ConfigurationCard.
- **UI Audit**: Enhanced Focus Mode helper text visibility with keyboard hints (← / E / →).
- **UI Audit**: Renamed "Triage" to "Edit" in Focus Mode to match the pencil icon.
- **Test Stability**: Updated SettingsModal tests to reflect new always-visible AnkiConnect inputs.

### Changed
- **Anki Troubleshooting**: Surfaced AnkiConnect URL and added a live connection status indicator in Settings (no longer hidden under Advanced).

## [1.11.0] - 2026-03-08

### Added
- **Grounding Metadata**: Cards now carry `rationale`, `source_excerpt`, and `relation_keys` for auditable provenance
- **Relation Coverage**: Coverage ledger tracks concept-map relations alongside pages and concepts
- **Early Stopping**: Generation loop exits when the model signals completion and coverage thresholds are met
- **Selective Reflection**: Reflection replaces coarse batch-swap with scored card selection that maximises coverage diversity

### Changed
- **Coverage Dict**: Trimmed bloated coverage payload — removed full ID/key lists, kept counts and percentages
- **Card Deduplication**: `get_card_key` strips HTML, cloze syntax, and punctuation for better duplicate detection
- **Prompts**: Generation prompt requests grounding fields; reflection prompt no longer asks model to self-score
- **SSE Schema**: Relaxed `.strict()` to `.passthrough()` on `CardDataSchema` to tolerate internal metadata

### Removed
- `response_chars` from AI client returns, `response_length` from session logs
- `quality_score`/`quality_flags` from Pydantic schema (local scoring is more reliable than LLM self-assessment)
- Redundant service events (`"Generation run started"`, `example_count_hint`, `mime_type` on step_end)
- `coverage_data` payloads from per-batch and post-generation events (final coverage at `done` is sufficient)

## [1.10.1] - 2026-03-08

### Fixed
- **Live Preview**: Stabilized card list; removed redundant 2.5s polling that raced with NDJSON stream and caused flicker between skeletons and cards
- **Live Preview**: Fixed virtualization (scroll ref on outer container, stable `getItemKey`); disabled virtualization during streaming for stability
- **Live Preview**: Added `reconcileCardUids` to preserve card identity across `cards_replaced` and sync refresh
- **Skeleton**: Improved visibility with `bg-border/60` for perceptible pulse animation

## [1.9.2] - 2026-02-24

### Fixed
- **Stability**: Resolved "Maximum update depth exceeded" React crash (error #185) by stabilizing store selectors with `useShallow`
- **Logic**: Fixed an infinite re-render loop in `ProgressView` caused by setting state during render
- **Imports**: Fixed "Can't find variable: useMemo" in `useTrickleProgress`

## [1.9.1] - 2026-02-24

### Added
- **New Components**: Introduced `ActivityLog`, `CardToolbar`, `ProgressFooter`, `CardList`, and `CardItem` to modularize the progress view
- **Selectors**: Added `useLecternSelectors` hook for optimized and cleaner state access
- **UI Architecture**: Major refactor of `ProgressView.tsx` into a more maintainable component-driven structure

### Changed
- **Performance**: Switched from `JSON.parse(JSON.stringify())` to `structuredClone()` for card cloning in the review slice
- **UI**: Enhanced the progress tracking layout with better separation of concerns and improved state management

## [1.9.0] - 2026-02-24

### Added
- **ProgressView**: Comprehensive new view for tracking generation progress with real-time updates
- **Focus Mode Enhancements**: Swipe gestures, card animations, and refined keyboard shortcuts (`Cmd/Ctrl+Enter` for sync)
- **Rich Text Editing**: Introduced TipTap-based rich text editing for flashcard fields
- **Real-time Streaming**: Phase-based progress tracking and time estimation via SSE
- **Database Schema Versioning**: Migration system and improved connection handling for the SQLite backend
- **Deck Generation Configuration**: New flow for deck configuration and estimation with dedicated UI

### Changed
- Reimplemented time estimation using exponential smoothing on progress percentage
- Migrated session and history management to a dedicated database utility
- Removed legacy budget limit functionality from settings
- Refactored frontend tests to use direct Zustand store interaction
- Synchronized configuration card inputs with global state

## [1.8.0] - 2026-02-23

### Added
- New **Anki Health Panel** for real-time connection diagnostics and troubleshooting
- Enhanced `AnkiConnector` with robust health checks and better version validation
- Improved `LecternAIClient` token management and model profile configuration

### Changed
- Refined state management in `store.ts` for connection status tracking
- Finalized migration of configuration management to a singleton pattern
- UI updates in `ProgressView.tsx` for cleaner health reporting

## [1.7.0] - 2026-02-23

### Added
- Cloze card creation and enhanced backend card persistence/management
- Keyboard shortcuts modal, card editor, batch action bar, and focus mode components
- Global error boundary and granular sync failure reporting with dedicated UI

### Fixed
- Pyre configuration for proper module resolution and static analysis robustness

### Changed
- Refined `main.py` logic and updated Claude local settings
- Improved UI component tests for reliability and async handling

## [1.6.1] - 2026-02-21

### Fixed
- Windows crash on launch: force `edgechromium` (WebView2) backend in `webview.start()` to bypass broken WinForms/pythonnet CLR path in PyInstaller bundles
- Windows spec: add `webview.platforms.edgechromium`, `clr`, and `pythonnet` as hidden imports so PyInstaller bundles the correct backends; fix `strip=False` on EXE (Unix-only flag, was risking PE corruption)
- CORS: add ports `4173` and `localhost` variants to `FRONTEND_ORIGINS` — production server port was missing, blocking all API calls in bundled app on every platform
- `sys.path` setup in `main.py` now uses `Path(__file__).resolve()` for reliable path resolution in frozen environments
- Pin `pythonnet>=3.0.3` on Windows for robust `clr_loader` support in PyInstaller `_internal/` layout

## [1.6.0] - 2026-02-13

### Added
- Interactive page filtering in the coverage grid
- Collapsible sidebar panes in the review view
- Improved card metadata handling and response parsing robustness

## [1.5.4] - 2026-02-11

### Fixed
- Thinking fallback: AI client now gracefully handles models that reject `thinking_level` config (auto-detects support and retries without thinking)
- Anki model name validation: `resolve_model_name` now verifies configured note types exist in Anki before export, falling back to built-in "Basic"/"Cloze" if not found
- Config save now warns when configured `basic_model` or `cloze_model` names don't match any Anki note type
- Added debug logging for AI model name, SDK version, and thinking state on init and each request

## [1.5.2] - 2026-02-10

### Fixed
- Onboarding now auto-detects Anki connection (polls every 3s instead of requiring manual retry)
- AnkiConnect URL changes in Settings now take effect immediately (fixed stale config import)
- Settings UI validates Anki URL format before saving to prevent invalid URLs


## [1.5.1] - 2026-02-10

### Fixed
- Build script paths in GitHub Actions workflow and PyInstaller shell/PowerShell scripts
- Spec file path resolution for cross-platform builds


## [1.5.0] - 2026-02-10

### Changed
- Major project reorganization: moved core logic to `lectern/`, assets to `resources/`, and configurations to `specs/`
- Standardized internal imports across the entire codebase
- Cleaned up build scripts and PyInstaller specification files for absolute path reliability


## [1.4.0] - 2026-02-10

### Added
- Introduce card count targeting and streaming logic for generation
- Centralize PDF processing and generation logic
- Add release workflow documentation

### Changed
- Remove unused PhaseAnimation and SkeletonCard components, update ProgressView for cleaner state handling
- Update frontend store types and refresh test assets
- Refactor and enhance various components and services

## [1.3.0] - 2026-02-10

### Added
- Enhance AI client with thinking profiles and improve tag context management
- Enhance concept schema and improve history management in AI client

### Fixed
- Remove density clamping in frontend and extend card generation cap during reflection phase

### Changed
- Overhaul content processing with a new generation loop and cost estimation
- Remove obsolete audit documentation and finalize pending refactors
- Check if ci / cd pipeline works since last release
- Run all tests (and fix bugs)
