# Frontend Architecture

The UI is a modern React application built with Vite and TypeScript, found in `gui/frontend/`.

## Architecture Overview
- **Framework:** React 18 + TypeScript
- **State Management:** Zustand
- **Styling:** Tailwind CSS + Framer Motion

## State Management (`store.ts`)
Zustand is the single source of truth. All application state, from user preferences to the real-time card generation progress, lives in `gui/frontend/src/store.ts`. 
- **No prop drilling:** Components subscribe strictly to the slices of state they need.
- **Persistence:** Critical settings (like the density target or selected Anki deck) are automatically synced to `localStorage`.
- **Session persistence boundary:** Active generation session persistence is handled by a dedicated storage service (`logic/activeSessionStorage.ts`) driven by store subscriptions, not by event reducers.

## Server-Sent Events (SSE)
Because AI generation is a long-running process, the frontend relies on an event stream.
1. The user triggers generation via a REST call (`api.ts`).
2. The UI immediately opens an `EventSource` connection to the FastAPI backend.
3. The backend yields standard `ServiceEvent` objects.
4. The frontend's `processGenerationEvent()` function parses events and performs state-only updates in Zustand, keeping stream processing pure while side effects are handled elsewhere.

*(Adding a new event type requires updates to both `EventType` in the Python backend and `processGenerationEvent` in the frontend).*
