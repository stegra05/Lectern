# Audit: Anki Integration

**Files:** `anki_connector.py`, `utils/note_export.py`, `utils/tags.py`  
**Audited:** 2026-02-09  
**Role:** Communication with Anki, card → note conversion, tag formatting.

## Summary

The Anki integration layer is robust and mostly clean. `anki_connector.py` is a solid HTTP wrapper. `utils/tags.py` handles the 4-level hierarchy logic correctly. `utils/note_export.py` contains the dead `media` upload logic that matches the schema cleanup we planned in `ai_layer`.

**Key actions:**
- Cut `media` upload logic from `note_export.py` (cascading from AI schema change)
- Keep `anki_connector.py` mostly as-is (media upload utility can stay as library code)

---

## Findings

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 100-130 | note_export | 🟡 | `upload_card_media` relies on `card["media"]` which we are removing from the AI schema. | **CUT** |
| 26, 28-30 | note_export | 🟡 | `ExportResult.media_uploaded`. Dead field once upload logic is removed. | **CUT** |
| 161, 189 | note_export | 🟡 | Calls to `upload_card_media` in `export_card_to_anki`. | **CUT** |
| 95-110 | anki_connector | 🟢 | `store_media_file`. The low-level API wrapper for `storeMediaFile`. Even if we cut the *auto-generation* of media, this utility is worth keeping for future features (e.g. user-attached images in manual review). | **KEEP** — as library utility. |
| 105-107 | tags | 🟢 | Comments about removed legacy functions (`infer_slide_set_name_with_ai`, `build_grouped_tags`). | **CUT** — clean up comments. |
| 178-213 | anki_connector | 🟢 | `sample_examples_from_deck` — fetches real cards to use as few-shot examples. Smart feature. | **KEEP** |

---

## Action Plan

1. **`note_export.py`**: Remove `upload_card_media`, `ExportResult.media_uploaded`, and the call in `export_card_to_anki`.
2. **`tags.py`**: Delete legacy comments.
3. **`anki_connector.py`**: No changes.
