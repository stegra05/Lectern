# AI Pipeline & Pacing Strategy

Lectern uses Google Gemini 3 Flash as the core engine for multimodal flashcard generation. The pipeline is orchestrated by `lectern_service.py`, using dedicated phase handlers in `phase_handlers.py`, and strictly interacts via `ai_client.py`.

## Core Constraints
1. **Multimodal Context:** `pypdf` extracts text and images. Even if text is dense, image counts are tracked per page so the AI knows if a slide is "visual", preventing it from hallucinating text on a diagram-heavy page.
2. **Structured Output:** Gemini generates strict JSON. To bypass schema bugs with `additionalProperties: false`, the app uses a list of key-value pairs (e.g., `[{"name": "Front", "value": "..."}]`) mapped through Pydantic models.

## The 3-Phase Generation Loop

### 1. Concept Map
Before generating any cards, the engine sends the *entire* parsed PDF to Gemini to build a global knowledge graph. This extracts core concepts, definitions, and relationships, which grounds the subsequent generation phases to prevent repetitive or narrow cards.

### 2. Batched Generation + Grounding Gate
Cards are not generated all at once. The engine splits work into batches to avoid context bloat and hallucination, then applies a grounding gate before promotion.
- **Avoid List:** Each generation batch includes a list of previously generated card fronts to ensure Gemini doesn't repeat itself.
- **Hybrid Batch Sizing:** Batch size is primarily target-aware and secondarily page-guardrailed. The system computes a target-derived size from `total_cards_cap * DYNAMIC_BATCH_TARGET_RATIO`, constrains it within page-derived guardrail bounds, then applies final dynamic min/max clamps. This keeps batches quality-oriented while still respecting document shape.
- **Pacing System:** Managed by `ai_pacing.py`. Based on the character density per page, the app switches between **Script** (>1500 chars/page), **Normal**, and **Slides** mode to adjust the token budget and card target density dynamically.
- **Micro Repair Loop:** Candidates that fail grounding/provenance quality checks can be repaired in focused retry passes.
- **Promotion Gate:** Only cards that pass grounding checks are promoted into the working set for downstream phases.

### 3. Reflection Pass
A post-generation QA pass. The system reviews promoted cards against learning best practices (atomicity, clarity) and improves them while preserving grounding quality (replacements are re-checked before acceptance). The number of reflection rounds is dynamic based on PDF length to manage costs without sacrificing quality on smaller sets.

## Stream Semantics for UI Recovery
The V2 transport (`/generate-v2`) emits monotonic `sequence_no` values in each envelope. The frontend stores the latest `sequence_no` as a replay cursor and sends it back as `after_sequence_no` when resuming.

On resume with a cursor, the backend replays missed events before live resume events so the UI can reconstruct state without gaps. Stream failures before the first event are returned as HTTP errors; failures after streaming starts are represented as terminal `error_emitted` events.
