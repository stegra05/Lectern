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

## Generation Event Streaming (V2 NDJSON)
Because AI generation is a long-running process, the frontend consumes a V2 NDJSON event stream over `fetch` (not `EventSource`).
1. The user triggers generation via `api.ts` (`/generate-v2`).
2. The frontend reads newline-delimited JSON envelopes from the response body.
3. Each envelope is validated against `ApiEventV2Schema` (`schemas/sse-v2.ts`).
4. `processGenerationEventV2()` maps V2 events into legacy UI event shapes (`mapV2EventToLegacyEvent`) and then applies state updates through `processGenerationEvent()`.

If you add a new V2 event type, update all of:
- `ApiEventType` in `lectern/application/dto.py`
- translator mapping in `lectern/application/translators/event_translator.py`
- frontend schema in `gui/frontend/src/schemas/sse-v2.ts`
- frontend handling in `gui/frontend/src/logic/generation.ts`
