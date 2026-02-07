# Feature: History Filter (Completed Only)

## Summary
Filter the history list to show only completed/synced decks by default, with option to show all.

## Status: Refined

---

## Requirements

### Filter Options
- **All** — Show all sessions (current behavior)
- **Completed** — Only `status === "completed"`
- **In Progress** — `status === "draft"`
- **Errors** — `status === "error"`

### Default Behavior
- Default to "Completed" filter
- Persist preference in localStorage

### UI
- Filter chip row above history list in `DashboardView.tsx`:
  ```
  [All] [Completed ✓] [In Progress] [Errors]
  ```

---

## Technical Notes

### Frontend Only
1. Add `historyFilter` state to DashboardView or `useAppState`
2. Filter `historyEntries` array before rendering
3. No backend changes

### History Statuses (Current)
- `draft` — Session in progress or not synced
- `completed` — Successfully synced to Anki
- `error` — Generation failed

---

## Open Questions

1. Should we add more granular statuses?
   - `synced` vs `not_synced` (within draft)?
   *Recommendation: Keep simple for now*

2. Show count per filter? e.g., `[Completed (12)]`
