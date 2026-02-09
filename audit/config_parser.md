# Audit: `config.py` + `pdf_parser.py`

**Audited:** 2026-02-09  
**Lines:** 219 (`config`) + 325 (`pdf_parser`) = 544  
**Role:** Configuration + PDF ingestion.

## Summary

`config.py` has critical bugs (persistence) and bloat. `pdf_parser.py` is robust but outdated — relying on `pypdf` + `pdfium` + `pytesseract` when Gemini can process PDFs natively. The OCR logic is fragile (hard dependency) and rarely used.

**Key actions:**
- Fix `user_config.json` persistence (🔴 bug)
- Cut 6+ outdated config options
- Cut OCR logic (fragile, redundant with multimodal AI, hard dependency)
- Architecture Note: Plan migration to native Gemini PDF upload (Phase 2)

---

## Theme 1: Configuration Issues

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 42-45 | config | 🔴 | `_CONFIG_DIR = os.path.dirname(...)` resolves to inside the app bundle / install dir. On updates, this dir is replaced, wiping `user_config.json`. Persisted settings are lost. | **FIX** — use `path_utils.get_app_data_dir()` for user config. |
| 97 | config | 🟡 | `GEMINI_THINKING_LEVEL`. Single global setting is inflexible. | **CUT** — replace with per-call profiles in `ai_client`. |
| 101 | config | 🟡 | `LIGHTWEIGHT_MODEL`. Seemingly unused. | **VERIFY** usage, likely CUT. |
| 153 | config | 🟡 | `MAX_NOTES_PER_BATCH`. Technical limit, not user pref. | **REFACTOR** — keep internal/hardcoded. |
| 156-163 | config | 🟡 | `REFLECTION_MAX_ROUNDS`, `ENABLE_REFLECTION`. Toggle bloat; reflection should always be on + dynamic. | **CUT** |
| 190-192 | config | 🟡 | `GEMINI_GENERATION_TEMPERATURE` (0.8), `GEMINI_NORMAL_MODE_TEMPERATURE` (0.9). Both below Google's recommended 1.0 for Gemini 3. | **CUT** — replace with single `GEMINI_TEMPERATURE = 1.0`. |
| 21-24 | config | 🟢 | `.env` loading. Fallback for headless/Linux environments where keychain fails. Not redundant, but useless in packaged apps (cwd is unpredictable). | **KEEP** — as dev/Linux fallback. Log warning if keychain fails & no .env. |

---

## Theme 2: PDF Parsing & Architecture

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 90-114 | pdf_parser | 🟡 | **OCR logic.** Depends on `pytesseract` (system binary). On Windows/Linux/macOS without brew, this crashes or fails silently. Gemini acts as a superior multimodal OCR. The logic (attempt OCR if text < 50 chars) is sound for "Scholar" era, but obsolete in "Gemini" era. | **CUT** — Remove hard dependency. Rely on multimodal AI for image text. |
| 76 | pdf_parser | 🟢 | `scale = dpi / 72`. Correct DPI math (PDF base unit is 1/72 inch). Not magic. | **KEEP** |
| 28 | pdf_parser | 🟢 | `page_number` flows through system to `slide_number` in frontend. Frontend code attempts to render it (`SLIDE {card.slide_number}`). Any invisibility is likely a CSS/data issue, not a parser bug. | **KEEP** |
| - | pdf_parser | 🔵 | **Architecture Debt.** The entire module manualy mimics what Gemini 1.5/2.0/3.0 does natively (PDF understanding). It extracts text + images + layout info page-by-page. | **PLAN** — "Generation 2.0": Deprecate this parser. Upload PDF to Gemini Files API once, prompt for page ranges. Solves all local dependency issues. |

---

## Validated "Magic Numbers"

| Constant | Value | status | Note |
|----------|-------|--------|------|
| `MIN_CARDS_PER_SLIDE` | 0.8 | ✅ | Reasonable floor. |
| `CARDS_PER_SLIDE_TARGET` | 1.2 | ✅ | Good default density. |
| `CHARS_PER_CARD_TARGET` | 200 | 🟡 | Low? (Script mode uses 500). Verify. |
| `DENSE_THRESHOLD` | 1500 | 🔴 | Inconsistent with service (2000). Align to 1500. |
| `SCRIPT_CHARS_PER_CARD` | 500 | ✅ | Reasonable for dense text. |
| `GEMINI_IMAGE_TOKEN_COST` | 258 | 🟡 | **Unverified.** Source unknown. |

---

## Action Plan

1. **Config Persistence:** Change `_USER_CONFIG_PATH` to use `get_app_data_dir()`.
2. **Config Cleanup:** Remove the 6 flagged options.
3. **Parser Cleanup:** Remove `pytesseract` import and OCR block.
4. **Consistency:** Align `DENSE_THRESHOLD` to 1500 everywhere.
