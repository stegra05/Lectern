# AI Pipeline & Pacing Strategy

Lectern uses Google Gemini 3 Flash as the core engine for multimodal flashcard generation. The pipeline is orchestrated by `lectern_service.py`, using dedicated phase handlers in `phase_handlers.py`, and strictly interacts via `ai_client.py`.

## Core Constraints
1. **Multimodal Context:** `pypdf` extracts text and images. Even if text is dense, image counts are tracked per page so the AI knows if a slide is "visual", preventing it from hallucinating text on a diagram-heavy page.
2. **Structured Output:** Gemini generates strict JSON. To bypass schema bugs with `additionalProperties: false`, the app uses a list of key-value pairs (e.g., `[{"name": "Front", "value": "..."}]`) mapped through Pydantic models.

## The 3-Phase Generation Loop

### 1. Concept Map
Before generating any cards, the engine sends the *entire* parsed PDF to Gemini to build a global knowledge graph. This extracts core concepts, definitions, and relationships, which grounds the subsequent generation phases to prevent repetitive or narrow cards.

### 2. Batched Generation Loop
Cards are not generated all at once. The engine splits the work into batches to avoid context bloat and hallucination.
- **Avoid List:** Each generation batch includes a list of previously generated card fronts to ensure Gemini doesn't repeat itself.
- **Pacing System:** Managed by `ai_pacing.py`. Based on the character density per page, the app switches between **Script** (>1500 chars/page), **Normal**, and **Slides** mode to adjust the token budget and card target density dynamically.

### 3. Reflection Pass
A post-generation QA pass. The system reviews the generated cards against learning best practices (atomicity, clarity) and improves them. The number of reflection rounds is dynamic based on PDF length to manage costs without sacrificing quality on smaller sets.
