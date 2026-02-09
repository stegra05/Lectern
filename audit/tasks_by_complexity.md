# Lectern Audit: Engineering Task Backlog

**Generated:** 2026-02-09
**Source:** Audit files in `/audit/` (ai_layer, anki_integration, config_parser, frontend, gui_backend, lectern_service)

---

## How to Use This Document

1. **Pick a level** that matches your available time and risk appetite.
2. **Check prerequisites** before starting any task -- some depend on others.
3. **Follow the verification steps** to confirm each fix before moving on.
4. **Mark tasks done** by checking the box next to the task ID.

---

## Complexity Rubric

| Level | Label | Scope | Typical Time | Risk | Example |
|-------|-------|-------|--------------|------|---------|
| 1 | **Trivial** | Single-file cleanup, comments, dead code deletion. No behavior change. | < 15 min | None | Delete unused constants |
| 2 | **Small** | Single-file logic or config change. Low blast radius, obvious correctness. | 15-45 min | Low | Fix a config default value |
| 3 | **Moderate** | Multi-file refactor with a clear pattern. No architectural risk, but needs grep-level awareness of callers. | 45 min - 2 hr | Medium-low | Remove a field from schema + model + all call sites |
| 4 | **Complex** | Cross-module behavior change touching state flows, prompts, or AI output. Requires careful regression testing. | 2-4 hr | Medium | Redesign history pruning with rolling summary |
| 5 | **Strategic** | Architectural migration or feature redesign. Needs a sub-plan, staged rollout, and possibly feature flags. | 4+ hr / multi-session | High | Replace PDF parser with native Gemini upload |

---

## Quick Reference: All Tasks

| ID | Title | Level | Priority | Status |
|----|-------|-------|----------|--------|
| T01 | Delete dead constants in `ai_common.py` | 1 | P2 | [x] |
| T02 | Clean up legacy comments in `tags.py` | 1 | P3 | [x] |
| T03 | Delete archaeology comments in `lectern_service.py` | 1 | P3 | [x] |
| T04 | Clarify deferred-work comment in `lectern_service.py` | 1 | P3 | [x] |
| T05 | Remove dead fallback in `session.py` | 1 | P2 | [x] |
| T06 | Fix temperature to 1.0 and consolidate config | 2 | P1 | [x] |
| T07 | Fix config persistence path | 2 | P1 | [x] |
| T08 | Align `DENSE_THRESHOLD` to single source of truth | 2 | P1 | [x] |
| T09 | Fix mutable default in `AnkiCard.fields` | 2 | P3 | [x] |
| T10 | Increase `estimateCost` timeout to 60s | 2 | P3 | [x] |
| T11 | Internalize `MAX_NOTES_PER_BATCH` | 2 | P2 | [x] |
| T12 | Clarify batch-size clamping expression | 2 | P3 | [x] |
| T13 | Cut `media` field end-to-end | 3 | P1 | [x] |
| T14 | Cut config bloat (`ENABLE_REFLECTION`, `REFLECTION_MAX_ROUNDS`, thinking level) | 3 | P2 | [x] |
| T15 | Remove OCR / pytesseract dependency | 3 | P2 | [x] |
| T16 | Replace `_slide_set_context` mutation with setter | 3 | P2 | [x] |
| T17 | Fix `slide_number` visibility in `ProgressView` | 3 | P2 | [x] |
| T18 | Add per-call thinking level profiles | 4 | P1 | [x] |
| T19 | Redesign history pruning with rolling card summary | 4 | P1 | [ ] |
| T20 | Verify and fix resume/checkpoint system | 4 | P2 | [ ] |
| T21 | Verify Gemini image token cost (258) | 4 | P2 | [ ] |
| T22 | Verify and annotate Gemini 3 Flash pricing | 4 | P3 | [ ] |
| T23 | Session recovery on page refresh | 4 | P2 | [ ] |
| T24 | Add `importance` + `difficulty` to concept schema | 4 | P2 | [ ] |
| T25 | Remove TTL-based session pruning; explicit temp-file cleanup | 4 | P3 | [ ] |
| T26 | Native Gemini PDF upload (Generation 2.0) | 5 | P3 | [ ] |
| T27 | Decompose `lectern_service.py` monolith | 5 | P3 | [ ] |
| T28 | Expose estimated card count pre-generation | 5 | P3 | [ ] |

---

## Level 1 -- Trivial

### T01: Delete dead constants in `ai_common.py`

**Why:** ~74 lines of unused constants (`LATEX_STYLE_GUIDE`, `BASIC_EXAMPLES`, `EXAM_EXAMPLES`, `EXAM_PREP_CONTEXT`, `EXAM_REFLECTION_CONTEXT`) clutter the module. Nothing imports them.

**Files:** `ai_common.py`

**Implementation:**
- Delete lines 11-84 (the five constant blocks identified in audit).
- Run a project-wide grep for each constant name to confirm zero imports.

**Verification:**
- `rg "LATEX_STYLE_GUIDE|BASIC_EXAMPLES|EXAM_EXAMPLES|EXAM_PREP_CONTEXT|EXAM_REFLECTION_CONTEXT" --type py` returns zero results outside the deleted lines.
- Application starts and generates cards normally.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T02: Clean up legacy comments in `tags.py`

**Why:** Stale comments reference removed functions (`infer_slide_set_name_with_ai`, `build_grouped_tags`). Misleading to future readers.

**Files:** `utils/tags.py` (lines ~105-107)

**Implementation:**
- Delete the comment block referencing removed legacy functions.

**Verification:**
- Read through `tags.py` -- no references to deleted functions remain.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T03: Delete archaeology comments in `lectern_service.py`

**Why:** Lines ~607-610 contain "Previous fix used: ..." rationale comments that describe old code, not current behavior.

**Files:** `lectern_service.py`

**Implementation:**
- Delete the comment block. Keep the logic (`examples if len(all_cards) == 0 else ""`).

**Verification:**
- Logic unchanged; application generates cards normally.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T04: Clarify deferred-work comment in `lectern_service.py`

**Why:** Comment at L233-234 ("3c. Slide Set Name - DEFERRED") reads like a TODO, but the work is done at L272-276.

**Files:** `lectern_service.py`

**Implementation:**
- Rewrite comment to: `# 3c. Slide Set Name -- extracted from concept map response in step 5b below.`

**Verification:**
- Read the comment in context; it now accurately describes the code flow.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T05: Remove dead fallback in `session.py`

**Why:** `_get_runtime_or_404` has a `hasattr(session, "draft_store")` fallback that checks attributes only present on `SessionRuntime`, never on `SessionState`. The branch is always `False`.

**Files:** `gui/backend/session.py` (lines ~153-161)

**Implementation:**
- Remove the `hasattr` fallback block.
- Simplify: if no runtime found, raise 404 directly.

**Verification:**
- Start the GUI, trigger a generation, verify no 404 errors during normal flow.
- Attempt to hit an endpoint with an invalid session ID; confirm 404 is returned.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Backend engineer.

---

## Level 2 -- Small

### T06: Fix temperature to 1.0 and consolidate config

**Why:** Google explicitly recommends `temperature=1.0` for Gemini 3 models. Both current values (0.8 and 0.9) are below spec and can cause looping or degraded output. Two separate config values serve no purpose.

**Files:** `config.py`, `ai_client.py`

**Implementation:**
1. In `config.py`: replace `GEMINI_GENERATION_TEMPERATURE` (0.8) and `GEMINI_NORMAL_MODE_TEMPERATURE` (0.9) with a single `GEMINI_TEMPERATURE = 1.0`.
2. In `ai_client.py`: update all references to use `config.GEMINI_TEMPERATURE`.
3. If either old config key is exposed in `user_config.json` schema, remove it.

**Verification:**
- `rg "GEMINI_GENERATION_TEMPERATURE|GEMINI_NORMAL_MODE_TEMPERATURE" --type py` returns zero.
- Generate a small deck (5 slides); confirm output quality is at least equal.

**Prerequisites:** None.
**Risk:** Low -- Google's own recommendation.
**Owner:** Backend / AI integration.

---

### T07: Fix config persistence path

**Why:** `_CONFIG_DIR = os.path.dirname(...)` resolves inside the app bundle. Updates wipe `user_config.json`. Users lose their settings.

**Files:** `config.py`

**Implementation:**
1. Change `_USER_CONFIG_PATH` to use `path_utils.get_app_data_dir()` (already exists in the codebase).
2. Add a one-time migration: if old location has a config file but new location doesn't, copy it over.

**Verification:**
- Print / log the resolved config path; confirm it's under `~/Library/Application Support/Lectern/` (macOS) or equivalent.
- Write a setting, "update" (restart app), confirm setting persists.

**Prerequisites:** None.
**Risk:** Low. The migration step prevents data loss.
**Owner:** Backend engineer.

---

### T08: Align `DENSE_THRESHOLD` to single source of truth

**Why:** `lectern_service.py` L309 hardcodes `2000`, but `config.py` defines `DENSE_THRESHOLD_CHARS_PER_PAGE = 1500`. Two sources of truth for the same decision.

**Files:** `lectern_service.py`, `config.py`

**Implementation:**
- In `lectern_service.py` L309: replace the literal `2000` with `config.DENSE_THRESHOLD_CHARS_PER_PAGE`.
- Decide on the canonical value (audit recommends 1500). Set it in `config.py`.

**Verification:**
- `rg "chars_per_page > [0-9]" --type py` shows only the config reference.
- Test with a known dense PDF; confirm script mode triggers at the expected threshold.

**Prerequisites:** None.
**Risk:** Low. Behavior change is minor (threshold shifts by 500 chars).
**Owner:** Backend engineer.

---

### T09: Fix mutable default in `AnkiCard.fields`

**Why:** `fields: List[Dict[str, str]] = []` is a classic Python mutable default footgun. Pydantic likely handles it, but it's bad form and a latent bug.

**Files:** `ai_schemas.py`

**Implementation:**
- Change to `fields: List[Dict[str, str]] = Field(default_factory=list)`.

**Verification:**
- Create two `AnkiCard` instances without passing `fields`; confirm they have independent lists (`a.fields is not b.fields`).

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T10: Increase `estimateCost` timeout to 60s

**Why:** Hard 30s timeout on the `/estimate` call can fail for large PDFs on slow connections.

**Files:** `frontend/src/api.ts` (line ~268)

**Implementation:**
- Change `setTimeout(() => controller.abort(), 30000)` to `60000`.

**Verification:**
- Upload a large PDF (50+ pages); confirm estimate completes without abort.

**Prerequisites:** None.
**Risk:** None -- just a longer grace period.
**Owner:** Frontend engineer.

---

### T11: Internalize `MAX_NOTES_PER_BATCH`

**Why:** This is a technical limit to prevent Gemini output truncation, not a user preference. The GUI passes the default every time. Exposing it adds unnecessary API surface and config noise.

**Files:** `config.py`, `lectern_service.py`, potentially `gui/backend/` route definitions and frontend config forms.

**Implementation:**
1. Remove `MAX_NOTES_PER_BATCH` from `GenerationConfig` (or the user-facing config schema).
2. Keep it as a private constant in `lectern_service.py` or `config.py` (e.g. `_MAX_NOTES_PER_BATCH = 50`).
3. Remove from any frontend settings UI if present.

**Verification:**
- Grep confirms no user-facing exposure.
- Generation still respects the internal batch cap.

**Prerequisites:** None.
**Risk:** Low.
**Owner:** Backend engineer.

---

### T12: Clarify batch-size clamping expression

**Why:** `int(cfg.max_notes_per_batch or min(50, max(20, len(pages) // 2)))` is hard to read at a glance.

**Files:** `lectern_service.py` (line ~323)

**Implementation:**
- Rewrite as:
  ```python
  batch_size = max(20, min(50, len(pages) // 2))
  ```
- Add a short comment: `# Clamp batch size: at least 20, at most 50, targeting half the page count.`

**Verification:**
- Spot-check: 10 pages -> 20, 60 pages -> 30, 200 pages -> 50.

**Prerequisites:** T11 (once `cfg.max_notes_per_batch` is removed, the `or` fallback is gone).
**Risk:** None.
**Owner:** Any engineer.

---

## Level 3 -- Moderate

### T13: Cut `media` field end-to-end

**Why:** The `media` field in the Anki card schema is speculative. Gemini's structured output mode never populates it. It adds output tokens to every response and dead code in `note_export.py`.

**Files:** `ai_client.py`, `ai_schemas.py`, `utils/note_export.py`

**Implementation:**
1. `ai_client.py`: Remove `media` from `_ANKI_CARD_SCHEMA` properties and `required` list.
2. `ai_schemas.py`: Remove `media: Optional[List[Dict[str, Any]]] = None` from `AnkiCard`.
3. `note_export.py`:
   - Delete `upload_card_media` function (~lines 100-130).
   - Remove `media_uploaded` from `ExportResult` dataclass.
   - Remove calls to `upload_card_media` in `export_card_to_anki` (~lines 161, 189).
4. `lectern_service.py`: Remove media upload reporting block (~lines 431-433) if present.

**Verification:**
- `rg "media" --type py` -- confirm no references to card media remain (except `store_media_file` in `anki_connector.py`, which is kept as a library utility).
- Generate and export a deck; confirm cards sync to Anki without errors.

**Prerequisites:** None.
**Risk:** Low. Removing dead code only.
**Owner:** Backend / AI integration.

---

### T14: Cut config bloat (`ENABLE_REFLECTION`, `REFLECTION_MAX_ROUNDS`, `GEMINI_THINKING_LEVEL`)

**Why:** `ENABLE_REFLECTION` lets users sabotage quality. `REFLECTION_MAX_ROUNDS` conflicts with the dynamic rounds logic. `GEMINI_THINKING_LEVEL` is replaced by per-call profiles (T18).

**Files:** `config.py`, `lectern_service.py`, potentially `gui/backend/` routes and frontend settings.

**Implementation:**
1. `config.py`: Delete `ENABLE_REFLECTION`, `REFLECTION_MAX_ROUNDS`, `GEMINI_THINKING_LEVEL`.
2. `lectern_service.py`:
   - Remove all branches guarded by `ENABLE_REFLECTION` (reflection should always run).
   - Remove `REFLECTION_MAX_ROUNDS` override; use dynamic rounds only.
3. Remove from any frontend settings form / API schema.
4. Leave `LIGHTWEIGHT_MODEL` for now (marked VERIFY, not CUT).

**Verification:**
- `rg "ENABLE_REFLECTION|REFLECTION_MAX_ROUNDS|GEMINI_THINKING_LEVEL" --type py` returns zero.
- Generate a deck; confirm reflection phase runs automatically.

**Prerequisites:** T18 should be done concurrently or after, since `GEMINI_THINKING_LEVEL` removal assumes per-call profiles exist.
**Risk:** Medium-low. Behavior change: reflection is always on. This is the intended design.
**Owner:** Backend engineer.

---

### T15: Remove OCR / pytesseract dependency

**Why:** `pytesseract` is a hard system dependency (requires Tesseract binary). Fragile on Windows/Linux/macOS without Homebrew. Gemini's multimodal capabilities make local OCR redundant.

**Files:** `pdf_parser.py` (lines ~90-114), `requirements.txt` / `pyproject.toml`

**Implementation:**
1. Delete the OCR block in `pdf_parser.py` (the `if text_content < 50 chars, try OCR` logic).
2. Remove `pytesseract` from dependencies.
3. Remove `import pytesseract` and any `pdfium` OCR-related imports if solely for OCR.
4. Keep `pdfium` if it's still used for image extraction (check callers).

**Verification:**
- App installs without Tesseract binary present.
- Upload a scanned PDF; verify that the system still processes it (via Gemini multimodal, not local OCR).

**Prerequisites:** None.
**Risk:** Medium-low. Loss of offline OCR capability, but Gemini is strictly better for this use case.
**Owner:** Backend engineer.

---

### T16: Replace `_slide_set_context` mutation with setter

**Why:** `lectern_service.py` mutates `ai._slide_set_context` directly -- violating encapsulation of a "private" attribute. Fragile and hard to trace.

**Files:** `ai_client.py`, `lectern_service.py`

**Implementation:**
1. `ai_client.py`: Add `set_slide_set_context(self, deck_name: str, slide_set_name: str)` method (see audit for full implementation). Pre-builds the tag context string and caches it.
2. `lectern_service.py`: Replace `ai._slide_set_context = slide_set_context` (L284) with `ai.set_slide_set_context(deck_name=cfg.deck_name, slide_set_name=slide_set_name)`.
3. Update `_build_tag_context` in `ai_client.py` to read from `self._tag_context_cache`.

**Verification:**
- Generate a deck with a known deck/slide-set name; confirm tags use the correct `Deck::SlideSet::Topic` hierarchy.
- `rg "_slide_set_context\s*=" --type py` shows only the setter, not external mutation.

**Prerequisites:** None.
**Risk:** Low. Behavioral equivalent; just better encapsulation.
**Owner:** Backend / AI integration.

---

### T17: Fix `slide_number` visibility in `ProgressView`

**Why:** Two bugs: (1) `{card.slide_number && ...}` is falsy when `slide_number === 0`, hiding the first slide's indicator. (2) Absolute positioning at `bottom-4` clips under long card content.

**Files:** `frontend/src/ProgressView.tsx` (line ~570)

**Implementation:**
1. Change truthiness check from `card.slide_number && ...` to `card.slide_number !== undefined && ...` (or `!= null`).
2. Move the slide indicator from absolute `bottom-4` to the card header row (next to model name).

**Verification:**
- Generate from a PDF; confirm `SLIDE 1` (i.e. slide index 0) is visible.
- Check that the indicator doesn't clip or overlap on cards with long content.

**Prerequisites:** None.
**Risk:** Low. Pure UI fix.
**Owner:** Frontend engineer.

---

## Level 4 -- Complex

### T18: Add per-call thinking level profiles

**Why:** A global `"low"` thinking level underserves concept map and reflection calls, which benefit significantly from deep reasoning. Card generation is fine at low.

**Files:** `ai_client.py`, `config.py`

**Implementation:**
1. Define a `_THINKING_PROFILES` dict in `ai_client.py`:
   ```python
   _THINKING_PROFILES = {
       "concept_map": "high",
       "generation":  "low",
       "reflection":  "high",
   }
   ```
2. In each AI method (`concept_map`, `generate_more_cards`, `reflect`), override the generation config with the appropriate thinking level via `model_copy(update={...})` (see audit `ai_layer.md` Theme 2 for full code).
3. Remove the global `GEMINI_THINKING_LEVEL` from `config.py` (coordinated with T14).

**Verification:**
- Enable debug logging; confirm `thinking_level` in API calls matches the profile (high for concept map, low for generation, high for reflection).
- Compare output quality of concept maps before/after (subjective but should show richer relations).

**Prerequisites:** T06 (temperature consolidation) should be done first so the generation config is clean.
**Risk:** Medium. Adds ~2-5s latency to concept map and reflection calls. Token cost increase is marginal (these are infrequent calls).
**Owner:** AI integration engineer.

---

### T19: Redesign history pruning with rolling card summary

**Why:** Current pruning (`history[:2] + history[-6:]`) drops all intermediate generation turns. The AI loses awareness of cards from early batches, causing concept repetition in large decks (100+ cards).

**Files:** `ai_client.py`, `lectern_service.py`

**Implementation:**
1. `ai_client.py`: Rewrite `_prune_history` to accept `all_card_fronts: List[str]`. After pruning, inject a synthetic "rolling card summary" message between the concept map exchange and recent turns (see audit `ai_layer.md` Theme 3 for full implementation).
2. `lectern_service.py`: In `_run_generation_loop`, pass the full list of card fronts to `_prune_history` instead of just the last 30.
3. Add a safety cap: if `len(all_card_fronts) > 200`, keep only the last 200 with a note.

**Verification:**
- Generate a large deck (80+ slides). Inspect the AI's chat history at batch 5+; confirm the summary message is present.
- Compare duplicate rate (front text similarity) between old and new pruning on the same PDF.
- Token usage should stay within ~2K tokens for the summary at 100 cards.

**Prerequisites:** None, but best done after T06 and T18 so the AI client is already cleaned up.
**Risk:** Medium. Changes the AI's context window composition. Thorough testing on 2-3 PDFs of varying size is essential.
**Owner:** AI integration engineer.

---

### T20: Verify and fix resume/checkpoint system

**Why:** `gui/backend/service.py` passes `resume=True` for every GUI run, but `create_session` generates a fresh `uuid4().hex` each time. The state file from a crashed session has a different ID. Resume is effectively dead in the GUI flow.

**Files:** `gui/backend/session.py`, `gui/backend/service.py`, `lectern_service.py`

**Implementation:**
1. **Test first:** Kill the app mid-generation. Restart. Confirm resume does NOT work (new session ID, old state file orphaned).
2. **Decide:** Either fix resume (persist session ID across restarts, e.g. in `localStorage` + backend handshake) or remove the checkpoint system entirely.
3. If **fixing**: store the active `session_id` in a known file path. On app start, check for an active session and offer to resume.
4. If **removing**: delete `_save_checkpoint`, `_load_checkpoint`, and the `resume` parameter chain. Clean up orphaned state files on startup.

**Verification:**
- If fixed: crash mid-generation, restart, confirm generation resumes from last checkpoint.
- If removed: `rg "checkpoint|resume" --type py` returns only intentional references. No orphaned state files accumulate in `/tmp`.

**Prerequisites:** None.
**Risk:** Medium. Either path touches multiple files and the session lifecycle. Removing is safer and simpler.
**Owner:** Backend engineer.

---

### T21: Verify Gemini image token cost (258)

**Why:** `GEMINI_IMAGE_TOKEN_COST = 258` has no cited source. Gemini docs say image token cost varies by resolution and model. The cost estimate shown to users could be wrong.

**Files:** `lectern_service.py` (line ~486), `config.py`

**Implementation:**
1. Use the Gemini SDK `count_tokens` method on a known image at the configured `media_resolution` setting.
2. Compare returned count to 258.
3. If different, update the constant and add a comment citing the test (model, resolution, date).
4. If `count_tokens` isn't available for images, add a `# Unverified` comment with the date and resolution assumption.

**Verification:**
- Cost estimate for a 20-slide PDF with images is within 10% of actual billed usage.

**Prerequisites:** None.
**Risk:** Low. Worst case: cost estimate is slightly off.
**Owner:** AI integration engineer.

---

### T22: Verify and annotate Gemini 3 Flash pricing

**Why:** The pricing table in `config.py` assumes Gemini 3 Flash matches 2.5 Flash pricing ($0.30/$2.50). No official pricing exists yet.

**Files:** `config.py` (lines ~206-211)

**Implementation:**
1. Check Google's published pricing page for Gemini 3 Flash.
2. If published: update the values.
3. If not yet published: add a comment `# Assumed: same as 2.5 Flash. Verify when stable pricing is published.`

**Verification:**
- Comment or updated value exists in config.
- Cost estimates for Gemini 3 Flash generations are reasonable.

**Prerequisites:** None.
**Risk:** None.
**Owner:** Any engineer.

---

### T23: Session recovery on page refresh

**Why:** Refreshing the browser during generation drops all UI state. The backend continues generating, but the user sees a blank slate with no way to reconnect.

**Files:** `frontend/src/store.ts`, potentially `frontend/src/api.ts`, `gui/backend/` session endpoints.

**Implementation:**
1. On generation start: persist `sessionId` to `localStorage`.
2. On app mount (`useEffect` or Zustand `onRehydrate`): check `localStorage` for a session ID.
3. If found, call a new backend endpoint (e.g. `GET /session/{id}/status`) to check if the session is still active.
4. If active: reconnect to the SSE stream and restore card state from the backend's `DraftStore`.
5. On generation complete or cancel: clear `localStorage`.

**Verification:**
- Start generation, refresh browser mid-way, confirm the UI reconnects and cards reappear.
- After generation completes and page is refreshed, confirm no stale reconnect attempt.

**Prerequisites:** T20 (resolve whether the backend's session/resume system works first).
**Risk:** Medium. Requires a new API endpoint and careful state reconciliation.
**Owner:** Full-stack engineer.

---

### T24: Add `importance` + `difficulty` to concept schema

**Why:** The concept map currently lacks prioritization signals. Adding `importance` (high/medium/low) and `difficulty` (foundational/intermediate/advanced) enables smarter card generation -- high-importance concepts get cards first, advanced topics get more atomic breakdown.

**Files:** `ai_client.py`, `ai_schemas.py`, `ai_prompts.py`

**Implementation:**
1. `ai_client.py`: Add `importance` and `difficulty` to `_CONCEPT_SCHEMA` properties and `required` list (see audit `ai_layer.md` Theme 1 for exact schema).
2. `ai_schemas.py`: Add corresponding fields to the Concept model if one exists.
3. `ai_prompts.py`: Update the concept map prompt to mention these new fields ("Rate each concept's importance to the lecture objectives and its cognitive difficulty level").
4. Update any downstream code that reads concept map output to handle the new fields.

**Verification:**
- Generate a concept map from a known lecture PDF; inspect the JSON response for `importance` and `difficulty` fields on every concept.
- Confirm the generation loop still works (it should ignore these fields for now unless you also wire them into pacing).

**Prerequisites:** None, but pairs well with T18 (high thinking for concept map).
**Risk:** Medium. Schema change affects AI output structure. Gemini must reliably fill enum fields.
**Owner:** AI integration engineer.

---

### T25: Remove TTL-based session pruning; explicit temp-file cleanup

**Why:** The 4-hour TTL in `session.py` is a server-side pattern unnecessary for a desktop app. The real concern is cleaning up `/tmp` PDF files. Explicit cleanup on session completion/failure is more predictable.

**Files:** `gui/backend/session.py`

**Implementation:**
1. Remove `SESSION_TTL_SECONDS` and the periodic pruning logic.
2. Add a `cleanup()` method to `SessionState` / `SessionRuntime` that deletes associated temp files.
3. Call `cleanup()` on session completion, failure, and app shutdown.

**Verification:**
- Generate a deck; confirm temp PDF is deleted after export/sync.
- Kill app mid-generation; restart; confirm orphaned temp files are cleaned up on next startup (add a startup sweep).

**Prerequisites:** None.
**Risk:** Low-medium. Need to ensure the cleanup hooks fire reliably.
**Owner:** Backend engineer.

---

## Level 5 -- Strategic

### T26: Native Gemini PDF upload (Generation 2.0)

**Why:** The entire `pdf_parser.py` module manually replicates what Gemini 1.5/2.0/3.0 does natively. Uploading the PDF via the Gemini Files API eliminates all local parsing dependencies (`pypdf`, `pdfium`, `pytesseract`) and gives the AI full document understanding.

**Files:** `pdf_parser.py` (deprecation), `ai_client.py` (new upload flow), `lectern_service.py` (orchestration change)

**Implementation (phased):**
1. **Phase A -- Prototype:** Upload a test PDF via `genai.upload_file()`. Prompt for page-range-specific extraction. Compare quality to current parsed output.
2. **Phase B -- Dual Path:** Add a config flag `USE_NATIVE_PDF = True`. When enabled, skip `pdf_parser.py` entirely; upload the PDF and prompt by page ranges.
3. **Phase C -- Cutover:** Once confident, remove the `pdf_parser.py` module and its dependencies. Update cost estimation (file upload has different token accounting).

**Verification:**
- Phase A: Side-by-side quality comparison on 3 diverse PDFs (text-heavy, image-heavy, mixed).
- Phase B: Both paths produce similar quality cards on the same input.
- Phase C: Full dependency removal; `pip install` no longer requires `pypdf`, `pdfium`, `pytesseract`.

**Prerequisites:** T15 (OCR removal) is a stepping stone.
**Risk:** High. Fundamentally changes the ingestion pipeline. Requires Gemini Files API quota and latency testing.
**Owner:** AI integration / architecture lead.

---

### T27: Decompose `lectern_service.py` monolith

**Why:** 739 lines handling 8 distinct concerns (validation, PDF parsing, AI orchestration, state management, cost estimation, Anki export, checkpoint management, reflection). Growing further will make the file unmaintainable.

**Files:** `lectern_service.py` -> multiple new modules

**Implementation (suggested split):**
1. `cost_estimator.py`: Extract `estimate_cost` (~L466-519) and pricing constants.
2. `generation_loop.py`: Extract `_run_generation_loop` and `_run_reflection_loop`.
3. `checkpoint.py`: Extract `_save_checkpoint` / `_load_checkpoint` (or delete per T20).
4. Keep `lectern_service.py` as a thin orchestrator that calls these modules.

**Verification:**
- All existing tests pass after extraction.
- Each new module can be tested independently.
- `lectern_service.py` shrinks to < 300 lines.

**Prerequisites:** T20 (checkpoint decision), T06, T08, T14 (config cleanup reduces noise before splitting).
**Risk:** Medium-high. Large refactor with many callers. Best done on a feature branch with thorough testing.
**Owner:** Architecture / senior backend engineer.

---

### T28: Expose estimated card count pre-generation

**Why:** Card count estimation exists internally but is only logged. Surfacing it to users before they click "Generate" sets expectations and enables informed decisions.

**Files:** `lectern_service.py`, `gui/backend/` routes, `frontend/src/api.ts`, frontend UI components

**Implementation:**
1. Add `estimated_card_count` to the `/estimate` endpoint response.
2. Compute it using the existing script-mode / slides-mode logic in `lectern_service.py` (lines ~313-320).
3. Display in the frontend cost preview UI (e.g. "~45 cards, ~$0.12").

**Verification:**
- Upload various PDFs; confirm the estimate is within 30% of actual cards generated.
- UI shows the count alongside cost before generation starts.

**Prerequisites:** T27 (if cost estimator is extracted, this wires into the new module).
**Risk:** Low functionally, but touches the full stack (backend + frontend).
**Owner:** Full-stack engineer.

---

## Suggested Execution Order

Work through these in waves. Each wave can be parallelized internally.

### Wave 1 -- Quick Wins & Correctness (Day 1)

| Tasks | Rationale |
|-------|-----------|
| T01, T02, T03, T04, T05 | Zero-risk cleanup. Gets the codebase tidy before real changes. |
| T06, T07, T08 | Critical config fixes. Correct defaults and persistence. |
| T09 | Trivial Pydantic fix, do alongside config work. |

### Wave 2 -- Dead Code Removal (Day 1-2)

| Tasks | Rationale |
|-------|-----------|
| T13 | Media field removal end-to-end. Largest dead code cut. |
| T14 | Config bloat removal. Simplifies the codebase for subsequent work. |
| T15 | OCR dependency removal. |
| T10, T11, T12 | Small frontend/config tweaks that ride along. |

### Wave 3 -- Encapsulation & UI (Day 2-3)

| Tasks | Rationale |
|-------|-----------|
| T16 | Slide set context setter. Better encapsulation before AI changes. |
| T17 | Slide number visibility fix. Quick frontend win. |

### Wave 4 -- AI Quality & Reliability (Day 3-5)

| Tasks | Rationale |
|-------|-----------|
| T18 | Per-call thinking profiles. Direct quality improvement. |
| T19 | History pruning redesign. Fixes duplicate generation in large decks. |
| T24 | Concept schema enrichment. Builds on T18's quality improvements. |

### Wave 5 -- Verification & Session Work (Day 5-7)

| Tasks | Rationale |
|-------|-----------|
| T20 | Resume/checkpoint verdict. Must decide before T23. |
| T21, T22 | Pricing/cost verification. Low effort, high confidence gain. |
| T23 | Session recovery. Depends on T20 outcome. |
| T25 | Session cleanup. Natural pairing with T20/T23. |

### Wave 6 -- Strategic (Future Sprints)

| Tasks | Rationale |
|-------|-----------|
| T26 | Native PDF upload. Major architecture shift; prototype first. |
| T27 | Monolith decomposition. Best after Waves 1-5 have stabilized the file. |
| T28 | Card count preview. Nice-to-have UX improvement. |

---

## Engineer Onboarding Checklist

Before starting work, confirm:

- [ ] You can run the app locally (`npm run dev` for frontend, Python backend starts).
- [ ] You have a test PDF (10-20 slides) for generation testing.
- [ ] Anki is installed locally with AnkiConnect plugin (for export verification).
- [ ] You have a Gemini API key configured (for AI call testing).
- [ ] You've read the audit doc for the area you're working on (linked in each task).
- [ ] You're working on a feature branch, not `main`.

### Commit Conventions

- One task per commit (or logical sub-task for Level 4-5).
- Prefix: `audit(T##): description` (e.g. `audit(T06): set temperature to 1.0`).
- Include the task ID in the commit body for traceability.

### Testing Protocol

| Level | Testing Required |
|-------|-----------------|
| 1 | Grep + app starts |
| 2 | Grep + targeted manual test |
| 3 | Grep + generate a small deck + export to Anki |
| 4 | Full generation test (small + large PDF) + inspect AI logs |
| 5 | Design review + staged rollout + A/B quality comparison |
