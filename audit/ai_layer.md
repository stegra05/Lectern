# Audit: AI Layer

**Files:** `ai_client.py`, `ai_common.py`, `ai_schemas.py`, `ai_prompts.py`  
**Audited:** 2026-02-09  
**Combined Lines:** ~844  
**Role:** Gemini SDK wrapper, prompt construction, structured output schemas, session logging.

## Summary

The AI layer is functional but carries legacy code, suboptimal defaults, and a fragile context management strategy. The biggest wins come from:
- Cutting dead code in `ai_common.py` (~50 lines of unused constants)
- Fixing temperature to Google's recommended `1.0` for Gemini 3
- Introducing per-call thinking levels (high for concept map/reflection, low for generation)
- Redesigning history pruning to preserve a rolling card summary
- Enhancing the concept map schema with `importance` and `difficulty` fields
- Removing the speculative `media` field from the card schema

**Key actions:**
- Cut `media` from `_ANKI_CARD_SCHEMA` and `AnkiCard`
- Set temperature to `1.0` (both config values)
- Add per-call `thinking_level` override (high for concept map + reflection)
- Redesign `_prune_history` with a rolling card summary
- Replace `_slide_set_context` mutation with a proper method
- Delete dead constants in `ai_common.py`

---

## Theme 1: Schema & Context Extraction

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 27-36 | ai_client | 🟢 | `_CONCEPT_SCHEMA` captures `id`, `name`, `definition`, `category`. Missing: `importance` (high/medium/low) to help the generation loop prioritize concepts. Also missing: `difficulty` (1-5 or beginner/intermediate/advanced) to inform card pacing — dense topics deserve more cards. Both work naturally with the user's custom focus prompt. | **REFACTOR** — add `importance` and `difficulty` fields. |
| 49-65 | ai_client | 🟢 | `_CONCEPT_MAP_SCHEMA` is solid. Captures objectives, concepts, relations, language, slide_set_name. The `relations` array is the most valuable part for maintaining context across batches. | **KEEP** |
| 87-98 | ai_client | 🟡 | `media` field in `_ANKI_CARD_SCHEMA`. Gemini's structured output mode does not generate raw base64 image data. This field is speculative — it adds output tokens to every response and is never populated in practice. Dead code in `note_export.py` (`upload_card_media`) depends on it. | **CUT** — remove from schema, `AnkiCard` Pydantic model, and `note_export.py`. |
| 30 | ai_schemas | 🟡 | `fields: List[Dict[str, str]] = []` — mutable default argument. Classic Python footgun. Pydantic may handle it internally, but it's bad form. | **REFACTOR** — use `Field(default_factory=list)`. |
| 34 | ai_schemas | 🟡 | `media: Optional[List[Dict[str, Any]]] = None` — same as above, remove. | **CUT** |

### Proposed `_CONCEPT_SCHEMA` Enhancement

```python
_CONCEPT_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "definition": {"type": "string"},
        "category": {"type": "string"},
        "importance": {
            "type": "string",
            "enum": ["high", "medium", "low"],
            "description": "How central this concept is to the lecture's learning objectives"
        },
        "difficulty": {
            "type": "string",
            "enum": ["foundational", "intermediate", "advanced"],
            "description": "Cognitive difficulty level for the target learner"
        },
    },
    "required": ["id", "name", "definition", "category", "importance", "difficulty"]
}
```

**How it integrates:**
- The generation loop can use `importance` to ensure high-importance concepts get cards first.
- The pacing system can use `difficulty` to allocate more cards to advanced topics (they need more atomic breakdown).
- The user's `focus_prompt` naturally interacts: "Focus on exam preparation" → the AI would mark applied/tricky concepts as `high` importance.

---

## Theme 2: Temperature & Thinking Level

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 163 | ai_client | 🟡 | `thinking_level` set to `config.GEMINI_THINKING_LEVEL` which defaults to `"low"`. Gemini 3 Flash defaults to `"high"` if unspecified. For concept map generation and reflection (which require deep reasoning about knowledge structure), `"low"` is leaving quality on the table. | **REFACTOR** — per-call thinking level. See design below. |
| 298 | ai_client | 🔴 | `gen_temperature = config.GEMINI_NORMAL_MODE_TEMPERATURE` (0.9). Google explicitly recommends `temperature=1.0` for Gemini 3 models. Going below 1.0 can cause looping or degraded performance. Both `GEMINI_GENERATION_TEMPERATURE` (0.8) and `GEMINI_NORMAL_MODE_TEMPERATURE` (0.9) are below recommended. | **REFACTOR** — set both to `1.0` in config. |
| 190-192 | config | 🟡 | Two separate temperature config values (`GEMINI_GENERATION_TEMPERATURE` and `GEMINI_NORMAL_MODE_TEMPERATURE`) that serve no distinct purpose now. One temperature is enough. | **CUT** — single `GEMINI_TEMPERATURE = 1.0`. |

### Proposed Per-Call Thinking Level

Instead of a global thinking level, override it per call type:

```python
# In ai_client.py — define thinking profiles
_THINKING_PROFILES = {
    "concept_map": "high",     # Deep reasoning: knowledge graph construction
    "generation":  "low",      # Fast: pattern-based card creation
    "reflection":  "high",     # Deep reasoning: quality critique
}

# In each method, override via model_copy:
def concept_map(self, pdf_content):
    call_config = self._generation_config.model_copy(update={
        "response_schema": _CONCEPT_MAP_SCHEMA,
        "thinking_config": types.ThinkingConfig(
            thinking_level=_THINKING_PROFILES["concept_map"]
        ),
    })
    # ...

def generate_more_cards(self, ...):
    call_config = self._generation_config.model_copy(update={
        "response_schema": _CARD_GENERATION_SCHEMA,
        "temperature": 1.0,
        "thinking_config": types.ThinkingConfig(
            thinking_level=_THINKING_PROFILES["generation"]
        ),
    })
    # ...

def reflect(self, ...):
    call_config = self._generation_config.model_copy(update={
        "response_schema": _REFLECTION_SCHEMA,
        "thinking_config": types.ThinkingConfig(
            thinking_level=_THINKING_PROFILES["reflection"]
        ),
    })
    # ...
```

**Trade-off:** High thinking for concept map + reflection adds ~2-5s latency per call and more output tokens. But these are infrequent calls (1 concept map, 2-5 reflection rounds) vs. potentially many generation batches. The cost is marginal; the quality gain is significant.

---

## Theme 3: Context Management (Critical)

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 224-235 | ai_client | 🟡 | History pruning: `history[:2] + history[-6:]`. Keeps concept map + last 3 turns. **Drops all intermediate generation turns.** This means the AI loses awareness of cards generated in early batches. The `avoid_fronts` list (last 30 cards) partially compensates, but for large decks (100+ cards across 5+ batches), the AI can repeat concepts from pruned batches. | **REFACTOR** — see redesign below. |
| 198-222 | ai_client | 🟡 | `_build_tag_context` uses `self._slide_set_context` which is mutated externally via `ai._slide_set_context = slide_set_context` (lectern_service.py L284). Direct mutation of a "private" attribute from outside the class. | **REFACTOR** — see design below. |
| 184-196 | ai_client | 🟢 | Language update acknowledges it can't change the system instruction mid-chat. The workaround (repeating language in per-turn prompts) works but wastes tokens. | **REFACTOR** (low priority) — either omit language from system prompt entirely (set it only in per-turn prompts), or recreate chat after concept map with correct language. |

### Proposed: `slide_set_context` as a Proper Method

Replace the external mutation pattern with an explicit setter that also rebuilds the tag context string (cached):

```python
class LecternAIClient:
    def __init__(self, ...):
        self._slide_set_context: Dict[str, Any] = {}
        self._tag_context_cache: str = ""

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        """Set the slide set context for hierarchical tagging."""
        self._slide_set_context = {
            "deck_name": deck_name,
            "slide_set_name": slide_set_name,
        }
        # Pre-build tag context string
        parts = []
        if deck_name:
            parts.append(deck_name.replace(' ', '-').lower()[:20])
        if slide_set_name:
            parts.append(slide_set_name.replace(' ', '-').lower()[:20])
        parts.append("[topic]")
        example_tag = "::".join(parts)

        self._tag_context_cache = (
            f"- Metadata (Hierarchical Tagging):\\n"
            f"    - Structure: Deck::SlideSet::Topic::Tag\\n"
            f"    - Example: {example_tag}\\n"
        )
```

Then in `lectern_service.py`, replace `ai._slide_set_context = slide_set_context` with:
```python
ai.set_slide_set_context(deck_name=cfg.deck_name, slide_set_name=slide_set_name)
```

### Proposed: History Pruning Redesign

**Problem:** Current pruning drops intermediate batches, losing awareness of previously generated cards.

**Solution:** After pruning, inject a **rolling card summary** as a synthetic user message. This gives the AI a compact memory of all generated cards without the token cost of full history.

```python
def _prune_history(self, all_card_fronts: List[str] | None = None) -> None:
    """Prune chat history with a rolling card summary.

    Strategy:
    - Always keep: concept map exchange (first 2 items)
    - Always keep: last 2 turns (4 items) for recency
    - Inject: compact summary of all generated cards as context
    """
    history = self.get_history()
    if len(history) <= 12:
        return  # No pruning needed

    # Build rolling summary
    summary_parts = ["[Context] Cards generated so far:"]
    if all_card_fronts:
        for i, front in enumerate(all_card_fronts, 1):
            summary_parts.append(f"  {i}. {front[:80]}")
    summary_text = "\n".join(summary_parts)

    # Reconstruct history: concept map + summary + recent turns
    concept_map_exchange = history[:2]       # Prompt + response
    recent_turns = history[-4:]              # Last 2 full turns

    # Insert summary as a synthetic user message + minimal model ack
    summary_exchange = [
        {"role": "user", "parts": [{"text": summary_text}]},
        {"role": "model", "parts": [{"text": "Understood. I have context of all cards generated so far."}]},
    ]

    new_history = concept_map_exchange + summary_exchange + recent_turns
    self.restore_history(new_history)
    logger.debug(f"[AI] Pruned history: {len(history)} -> {len(new_history)} items "
                 f"(with {len(all_card_fronts or [])} card summary)")
```

**Caller change** in `lectern_service.py` `_run_generation_loop`:
```python
# Before each generate call, pass card fronts to pruning
# (already computing recent_keys, just pass all_cards instead of recent 30)
all_fronts = [self._get_card_key(c) for c in all_cards if self._get_card_key(c)]
ai._prune_history(all_card_fronts=all_fronts)
```

**Trade-off analysis:**
- **Token cost:** ~80 chars × N cards. For 100 cards = ~8K chars ≈ ~2K tokens. Cheap.
- **Benefit:** AI never loses track of what it's already generated. Eliminates duplicate concepts across batches.
- **Risk:** Very large decks (500+ cards) could make the summary itself too large. Add a cap: if `len(all_card_fronts) > 200`, keep only the last 200 with a note "and N earlier cards."

---

## Theme 4: Dead Code

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 11-18 | ai_common | 🟡 | `LATEX_STYLE_GUIDE` — duplicate of `FORMATTING_RULES` in `ai_prompts.py`. Never imported elsewhere. | **CUT** |
| 20-26 | ai_common | 🟡 | `BASIC_EXAMPLES` — legacy string-based examples. Replaced by `_CARD_DATA` + `_make_example_str` in `ai_prompts.py`. | **CUT** |
| 28-34 | ai_common | 🟡 | `EXAM_EXAMPLES` — legacy exam mode examples. | **CUT** |
| 39-65 | ai_common | 🟡 | `EXAM_PREP_CONTEXT` — 26 lines of exam cram mode instructions. The `focus_prompt` system in `PromptBuilder` supersedes this. | **CUT** |
| 69-84 | ai_common | 🟡 | `EXAM_REFLECTION_CONTEXT` — legacy exam reflection instructions. Also superseded by `PromptBuilder.reflection()`. | **CUT** |

**Total dead code:** ~74 lines in `ai_common.py` (constants that nothing imports).

---

## Theme 5: Prompt Quality (Quick Scan)

| Line(s) | File | Sev | Finding | Verdict |
|----------|------|-----|---------|---------|
| 76-100 | ai_prompts | 🟢 | System instruction is clean: role, language, focus, principles, formatting, examples. Well-structured. | **KEEP** |
| 102-122 | ai_prompts | 🟢 | Concept map prompt is solid. Asks for objectives, concepts, relations, language, slide_set_name. Could mention `importance` and `difficulty` once the schema is enhanced. | **REFACTOR** (after schema update) |
| 141-160 | ai_prompts | 🟢 | Generation prompt. Line 149: `"Do NOT set 'done' to true until exhausted"` — strong instruction to prevent premature stopping. Good. | **KEEP** |
| 162-180 | ai_prompts | 🟢 | Reflection prompt. Clean QA framing. Could be enhanced to reference the concept map ("Check coverage against the concept map") once importance is available. | **REFACTOR** (after schema update) |

---

## Action Summary

| Priority | Action | Files Touched |
|----------|--------|---------------|
| 🔴 High | Set temperature to `1.0` | `config.py` |
| 🔴 High | Cut `media` from schema + Pydantic model | `ai_client.py`, `ai_schemas.py`, `note_export.py` |
| 🔴 High | Per-call thinking levels (high/low/high) | `ai_client.py`, `config.py` |
| 🟡 Medium | Redesign history pruning with rolling summary | `ai_client.py`, `lectern_service.py` |
| 🟡 Medium | Add `importance` + `difficulty` to concept schema | `ai_client.py`, `ai_schemas.py`, `ai_prompts.py` |
| 🟡 Medium | Replace `_slide_set_context` mutation with setter | `ai_client.py`, `lectern_service.py` |
| 🟡 Medium | Delete dead constants in `ai_common.py` | `ai_common.py` |
| 🟢 Low | Fix mutable default in `AnkiCard.fields` | `ai_schemas.py` |
| 🟢 Low | Consolidate two temperature configs into one | `config.py` |
| 🟢 Low | Try removing `# type: ignore` from imports | `ai_client.py` |
