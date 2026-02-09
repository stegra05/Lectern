# Audit: Frontend

**Files:** `store.ts`, `api.ts`, `ProgressView.tsx`  
**Audited:** 2026-02-09  
**Role:** State management, API communication, and UI rendering.

## Summary

The frontend is modern (React/Zustand) and robust for the most part. The API layer handles SSE streaming cleanly. The main fragility is **session persistence across page refreshes** — if the user refreshes during generation, the UI state is lost (though the backend continues). Visual bugs explain why "Slide Number" is rarely seen.

**Key actions:**
- Fix `slide_number` visibility (0-index bug + layout check)
- Plan: Session Recovery mechanism (reconnect to active session on load)
- Clean up `api.ts` timeout logic (30s estimation limit)

---

## Findings

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 570 | ProgressView | 🟡 | `{card.slide_number && ...}` check fails if `slide_number` is 0. Also, absolute positioning at `bottom-4` often conflicts with long card content or gets clipped by `overflow-hidden`. | **FIX** — change check to `!== undefined`, move indicator to top header next to model name. |
| 110 | store.ts | 🟡 | `getInitialState` resets `sessionId` to `null`. On page refresh (Cmd+R), the frontend disconnects from the running generation. The backend continues, but the user sees a blank slate. | **PLAN** — Store `sessionId` in `localStorage` and attempt reconnect/resume on mount. |
| 315 | store.ts | 🟢 | `processGenerationEvent` handles SSE stream. Logic is sound. | **KEEP** |
| 268 | api.ts | 🟡 | `setTimeout(() => controller.abort(), 30000)` in `estimateCost`. Hard 30s timeout might be too short for large PDFs on slow connections. | **REFACTOR** — bump to 60s or make configurable. |
| 143-145 | ProgressView | 🟢 | `SyncSuccessOverlay` animation is nice, provides good feedback. | **KEEP** |

---

## Action Plan

1. **Fix Slide Indicator:** Move to card header, fix 0-index check.
2. **Session Resilience:** Add `sessionId` to `localStorage` persistence in `store.ts`.
3. **Timeout Adjustment:** Increase `estimateCost` timeout to 60s.
