# Feature: Extended Density Slider with Manual Input

## Summary
Expand the density slider range and add a numeric input box for precise control.

## Status: Refined

---

## Requirements

### Slider Changes
| Property | Current | New |
|----------|---------|-----|
| Min | 0.8 | 0.1 |
| Max | 2.5 | 5.0 |
| Step | 0.1 | 0.1 |
| Default | 1.5 | 1.0 |

### UI Changes
- Add a small numeric input box next to the slider
- Keep them in sync bidirectionally
- Input validation: clamp to [0.1, 5.0], allow one decimal place

### Layout
```
┌─────────────────────────────────────────────────────┐
│  Detail Level                                       │
├─────────────────────────────────────────────────────┤
│  Concise          Balanced          Comprehensive   │
│  ├────────────────────●───────────────────────────┤ │
│                                           [1.0  ]   │
│              ~1.0 cards per page                    │
└─────────────────────────────────────────────────────┘
```

---

## Technical Notes

### Frontend Only
- Modify `ConfigView.tsx`:
  - Change `min`, `max`, initial `value`
  - Add `<input type="number">` synced with slider
- No backend changes required (just passes different number)

---

## Open Questions

1. Should the labels ("Concise", etc.) shift with new range?  
   *Recommendation: Keep at 1/4, 1/2, 3/4 positions*

2. Warning when exceeding 3.0? ("May result in many cards")
