# Lectern Feature Roadmap

> **Status:** Draft — Pending Review

## Overview

Seven features designed to enhance card management, customization, and session persistence.

---

## Feature Summary

| # | Feature | Complexity | Dependencies |
|---|---------|------------|--------------|
| 01 | [Card Sorting](./01_card_sorting.md) | Low | None |
| 02 | [Card Search](./02_card_search.md) | Low | None |
| 03 | [Focus Prompt](./03_focus_prompt.md) | Medium | Replaces Exam Mode |
| 04 | [Density Slider](./04_density_slider_input.md) | Low | None |
| 05 | [Session Management](./05_session_management.md) | **High** | None |
| 06 | [History Filter](./06_history_filter.md) | Low | None |
| 07 | [Card Deletion](./07_card_deletion.md) | Medium | Requires #05 |

---

## Suggested Implementation Order

### Phase 1: Quick Wins (Frontend Only)
1. **04 - Density Slider** — Simple range/input change
2. **06 - History Filter** — Client-side filter
3. **01 - Card Sorting** — Client-side sort
4. **02 - Card Search** — Client-side filter

### Phase 2: Focus Prompt (Replace Exam Mode)
5. **03 - Focus Prompt** — Medium complexity, touches AI pipeline

### Phase 3: Session Management (Core Feature)
6. **05 - Session Management** — High complexity, enables #07
7. **07 - Card Deletion** — Depends on session tracking

---

## Open Questions (Cross-Cutting)

1. **Card IDs:** Should we add unique IDs to cards for better tracking?
2. **State Migration:** How to handle existing sessions without the new fields?
3. **Test Strategy:** Unit tests vs manual browser testing for UI changes?
