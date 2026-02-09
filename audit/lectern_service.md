# Audit: `lectern_service.py`

**Audited:** 2026-02-09  
**Lines:** 739  
**Role:** Core orchestrator — PDF parsing → AI generation → reflection → Anki export.

## Summary

This file is a **monolith**. It handles validation, PDF parsing, AI orchestration, state management, cost estimation, and Anki export — at least 5 distinct concerns in one class. The code works, but carries config bloat, inconsistent thresholds, and speculative features that obscure the core logic.

**Key actions:**
- Cut 3 config options that add no value (`ENABLE_REFLECTION`, `REFLECTION_MAX_ROUNDS`, `MAX_NOTES_PER_BATCH` as user-facing)
- Fix the hardcoded 2000 vs config 1500 threshold inconsistency
- Clarify or remove the resume/checkpoint system
- Verify Gemini image token cost (258 is unconfirmed)
- Update pricing table for Gemini 3 Flash (currently assumed)

---

## Theme 1: Config Bloat

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 65-66 | 🟡 | `ENABLE_REFLECTION` config. Reflection is the quality pass — there's no reason to let users disable it. The toggle adds a param through 4 layers (config → service → backend → frontend) for zero benefit. | **CUT** |
| 66, 368 | 🟡 | `REFLECTION_MAX_ROUNDS` config. Dynamic logic at L359-367 already computes ideal rounds based on page count. The config override just adds a footgun (user sets 1, gets worse results) and dead branching. | **CUT** — always use dynamic rounds. |
| 64, 323 | 🟡 | `MAX_NOTES_PER_BATCH` exposed as user-facing param. This is a *technical* limit to prevent Gemini output truncation, not a user preference. The GUI passes the default every time. | **REFACTOR** — keep internally (hardcode or private config), remove from `GenerationConfig` params and API surface. |

---

## Theme 2: Dead or Speculative Code

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 397-410 | 🟢 | `skip_export` block. Looks like dead code at first glance, but `gui/backend/service.py:140` hardcodes `skip_export=True` for every GUI generation. This is the **primary GUI path** — it enables the draft-review-then-sync UX. | **KEEP** |
| 431-433 | 🟡 | Media upload reporting. The Anki card schema supports a `media` field (base64 images), and `note_export.py` has logic to upload them. But in practice, the AI never generates media objects. This loop never fires. | **VERIFY** — check Gemini session logs for any `media` output. If never produced, mark as speculative and consider removing from schema to save output tokens. |
| 160-167 | 🟡 | Resume/state logic. `gui/backend/service.py:139` passes `resume=True` for every GUI run. But each generation creates a *new* `session_id`, so the state file from a crashed session would have a different ID. Resume likely **never actually restores** in the GUI flow — the session IDs won't match. Checkpoints are written (L529+) but probably never read back. | **VERIFY** — test crash-and-resume flow. If session IDs don't carry over, this is dead code behind a `resume=True` that does nothing. |
| 529-555 | 🟡 | `_save_checkpoint` — writes state after every batch. Feeds the resume system above. Same concern: if resume is dead, these are wasted disk I/O every batch. | **VERIFY** — tied to resume verdict above. |

---

## Theme 3: Inconsistencies & Bugs

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 309 | 🔴 | Script mode threshold hardcoded as `chars_per_page > 2000`, but `config.py:179` defines `DENSE_THRESHOLD_CHARS_PER_PAGE = 1500`. The config constant is **never used** in this file. Two sources of truth for the same decision. | **REFACTOR** — use `config.DENSE_THRESHOLD_CHARS_PER_PAGE` or delete the config constant. Pick one value. |
| 323 | 🟡 | `int(cfg.max_notes_per_batch or min(50, max(20, len(pages) // 2)))` — confusing read. The `min(max(...))` clamps the batch size between 20-50 based on page count. The `50` *does* work (prevents 200 pages → 100 card batch). But it reads like nonsense at first glance. | **REFACTOR** — rewrite as `clamp(len(pages) // 2, lo=20, hi=50)` or just `max(20, min(50, len(pages) // 2))` for clarity. |
| 233-234 | 🟢 | Comment "3c. Slide Set Name - DEFERRED until after concept map" reads like a TODO, but the work *is* done at L272-276 (extracted from concept map response). | **REFACTOR** — rewrite comment to say "Slide Set Name — extracted from concept map in step 5b below" to avoid confusion. |
| 607-610 | 🟢 | Comment "Previous fix used: examples=examples if turn_idx == 0 else ''" is leftover rationale. The actual logic (`examples if len(all_cards) == 0 else ""`) is correct — only inject style examples on the first batch. | **REFACTOR** — delete the archaeology comments, keep the logic. |

---

## Theme 4: Estimation & Pricing Accuracy

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 486-488 | 🟡 | `GEMINI_IMAGE_TOKEN_COST = 258` — "Gemini: 258 tokens per image." No source for this number. Current Gemini docs say image token cost varies by resolution and model. The `media_resolution` parameter controls it. 258 may be from an older API version. | **VERIFY** — find official source or test empirically with `count_tokens` on a known image. |
| config.py 206-211 | 🟢 | Pricing table. **Gemini 2.5 Pro** ($1.25 in / $10.00 out) ✅ confirmed. **Gemini 2.5 Flash** ($0.30 in / $2.50 out) ✅ roughly correct. **Gemini 3 Flash** ($0.30 in / $2.50 out) — assumed same as 2.5 Flash, no published pricing. | **VERIFY** — flag Gemini 3 Flash pricing as "assumed" with a comment. Update when stable pricing is published. |

---

## Theme 5: Architecture

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 1-739 | 🟡 | **Monolith.** This single file handles: (1) validation, (2) PDF parsing orchestration, (3) AI session management, (4) generation loop, (5) reflection loop, (6) Anki export, (7) state/checkpoint management, (8) cost estimation. At minimum, `estimate_cost` (L466-519) could be its own module, and the generation/reflection loops are already extracted as methods but still live in the same 739-line file. | **REFACTOR** (future) — extract `estimate_cost` into a standalone module. Consider splitting generation/reflection loops if the file grows further. |
| 527 | 🟢 | `_should_stop` is a null-safe wrapper: `bool(stop_check and stop_check())`. First `stop_check` checks "is callable provided?" (it's `Optional`), second calls it. Python short-circuit evaluation. | **KEEP** — correct defensive pattern. |

---

## Theme 6: UX Opportunities

| Line(s) | Sev | Finding | Verdict |
|----------|-----|---------|---------|
| 313-320 | 🟢 | Card count estimation. Both script mode (`total_text_chars / 1000 * effective_target`) and slides mode (`pages × effective_target`) compute a `total_cards_cap`. This number is only logged as a `ServiceEvent("info")` — never surfaced to the user pre-generation. | **REFACTOR** (future) — expose estimated card count in the `/estimate` endpoint or as a pre-generation preview so users know what to expect before clicking Generate. |
