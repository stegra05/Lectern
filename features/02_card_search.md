# Feature: Card Search/Filter

## Summary
Allow users to search and filter generated cards before syncing to Anki. Search happens within Lectern's preview, not Anki directly.

## Status: Refined

---

## Requirements

### Search Scope
- **Search in:** `Front` and `Back` fields (Basic), `Text` field (Cloze)
- **Timing:** Available during and after generation, before syncing
- **Real-time:** Filter updates as user types (debounced ~200ms)

### UI/UX
- **Location:** Search bar above card list in `ProgressView.tsx`
- **Keybinding:** `Ctrl+F` / `Cmd+F` (if feasible in pywebview context)
- **Display:** Show match count (e.g., "12 of 45 cards")

---

## Technical Notes

### Implementation Approach
1. Add `searchQuery` state to ProgressView or `useGeneration`
2. Filter `cards` array with case-insensitive substring match on relevant fields
3. Optional: highlight matching text in card preview

### Considerations
- Performance: Client-side filtering is fast for typical card counts (< 500)
- Keybinding: May conflict with browser defaults in pywebview

---

## Open Questions

1. Should we support regex or advanced query syntax?  
   *Recommendation: Start simple, plain text search only*
2. Highlight matches within card text?
