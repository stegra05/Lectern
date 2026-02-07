# Feature: Card Sorting in Overview

## Summary
Allow users to sort cards in the ProgressView by various criteria to better navigate and review generated content before syncing.

## Status: Refined

---

## Requirements

### Sorting Criteria
Sort cards by:
1. **Concept Map Topic** — Group cards by detected topic from the global concept map
2. **Slide Number** — Chronological order from source PDF
3. **Card Type** — Group Basic vs Cloze cards
4. **Creation Order** — Default, order of generation

### UI/UX
- **Location:** Dropdown/pill selector above the card list in `ProgressView.tsx`
- **Default:** Creation order (current behavior preserved)
- **Persistence:** Save preference to localStorage

---

## Technical Notes

### Data Already Available
- `slide_number` exists on each card
- `slide_topic` exists on each card (from concept map)
- `model_name` indicates card type (Basic/Cloze)

### Implementation Approach
1. Add `sortBy` state to `useGeneration` hook or ProgressView
2. Apply client-side sorting on the `cards` array before rendering
3. No backend changes required

---

## Open Questions

1. Should sorting persist across sessions?
2. Group headers when sorting by topic (e.g., collapsible sections)?
