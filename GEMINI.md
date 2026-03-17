# Lectern — AI Agent Context

> **Identity:** You are an AI assisting with the Lectern App, a desktop tool that transforms PDFs into Anki flashcards via Google Gemini.
> **Tech Stack:** Python (FastAPI), React (Vite + Zustand), PyWebView, pypdf, AnkiConnect.

## The Four Laws of Lectern
Every change to this codebase must follow these principles:
1. **Safety Net Before Surgery:** Never refactor without a verification mechanism (write integration tests first).
2. **Strict Separation of Concerns:** No God components. Isolate UI, state, orchestration, and clients.
3. **Single Source of Truth:** Do not duplicate prompt logic, schemas, configurations, or event definitions.
4. **Boy Scout Rule:** Make incremental improvements. Do not halt progress for big-bang rewrites.

## Documentation Index
Instead of duplicating technical truths here, refer to the centralized `docs/` folder for architectural and implementation details:
- **`docs/ARCHITECTURE.md`:** System diagrams and data flow.
- **`docs/DEVELOPMENT.md`:** Setup, build scripts, and test commands.
- **`docs/DESIGN_SYSTEM.md`:** The "Anti-Slop" UI philosophy and styling rules.
- **`docs/AI_PIPELINE.md`:** Gemini interaction, generation phases, and pacing.
- **`docs/FRONTEND.md`:** React, Zustand, and Server-Sent Events.
- **`docs/BACKEND.md`:** FastAPI, Session Management, and Anki integration.

*Note: All end-user documentation is hosted externally on the Lectern landing page.*
