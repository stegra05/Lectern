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

## Server-Sent Events (SSE)
Because AI generation is a long-running process, the frontend relies on an event stream.
1. The user triggers generation via a REST call (`api.ts`).
2. The UI immediately opens an `EventSource` connection to the FastAPI backend.
3. The backend yields standard `ServiceEvent` objects.
4. The frontend's `processGenerationEvent()` function parses these events and updates the Zustand store in real-time, driving the UI progress bars and live preview.

*(Adding a new event type requires updates to both `EventType` in the Python backend and `processGenerationEvent` in the frontend).*
