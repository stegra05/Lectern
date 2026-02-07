# Feature: Card Deletion (Lectern + Anki Separation)

## Summary
Allow deleting cards from Lectern sessions. Anki deletion is a separate, explicit action.

## Status: Refined

---

## Requirements

### Delete from Lectern (Session State)
- Delete individual cards from a session
- **Does NOT** affect Anki — cards remain in Anki if synced
- Updates `card_count` in history entry
- Confirmation required: "Remove from Lectern? (Anki cards unaffected)"

### Delete from Anki (Separate Action)
- Explicit button: "Delete from Anki"
- Only available for cards that have `anki_note_id` stored
- **Requires confirmation:** "Permanently delete from Anki? This cannot be undone."
- Uses AnkiConnect `deleteNotes` API

---

## UI/UX

### Per-Card Actions
```
┌─────────────────────────────────────────────────────┐
│  [Card Preview]                                     │
│                                                     │
│  ═══════════════════════════════════════════════   │
│       [Edit] [Remove from Lectern] [🗑️ Anki]        │
└─────────────────────────────────────────────────────┘
```

- "Remove from Lectern" — Removes from session, keeps in Anki
- "🗑️ Anki" — Deletes from Anki (dangerous, requires confirmation)
- "🗑️ Anki" button only visible if `anki_note_id` exists

### Bulk Actions (Stretch Goal)
- Select multiple cards → "Remove Selected from Lectern"
- Select multiple cards → "Delete Selected from Anki"

---

## Technical Notes

### Backend Changes
1. Update session state API to support card removal:
   - `DELETE /session/{id}/cards/{card_index}` or
   - `PUT /session/{id}/cards` with updated array

2. Add Anki deletion endpoint:
   - `DELETE /anki/notes` with body `{ note_ids: [...] }`

### State Update
When removing from Lectern:
```python
# In session state
cards = [c for c in cards if c["id"] != card_id]
# Update history entry
history_manager.update_entry(session_id, card_count=len(cards))
```

### AnkiConnect Deletion
```python
import requests

def delete_anki_notes(note_ids: list[int]):
    return requests.post("http://localhost:8765", json={
        "action": "deleteNotes",
        "version": 6,
        "params": {"notes": note_ids}
    })
```

---

## Safety Considerations

| Action | Risk | Mitigation |
|--------|------|------------|
| Remove from Lectern | Low | Simple confirmation |
| Delete from Anki | HIGH | Strong warning, undo impossible |

### Confirmation Dialogs

**Remove from Lectern:**
> Remove this card from the session?  
> (Your Anki deck is not affected)  
> [Cancel] [Remove]

**Delete from Anki:**
> ⚠️ Permanently delete this card from Anki?  
> This action cannot be undone.  
> [Cancel] [Delete Permanently]

---

## Dependencies
- Requires Feature 05 (Session Management) to track `anki_note_id`

---

## Open Questions

1. Should we support "Delete all cards from this session in Anki"?
   *Recommendation: Yes, but with extra-strong confirmation*

2. Undo for Lectern removal? (Keep in local trash for 30 days?)
