from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from google import genai  # type: ignore
from google.genai import types  # type: ignore

import config
from ai_common import (
    LATEX_STYLE_GUIDE,
    BASIC_EXAMPLES,
    EXAM_EXAMPLES,
    EXAM_PREP_CONTEXT,
    EXAM_REFLECTION_CONTEXT,
    _compose_multimodal_content,
    _start_session_log,
    _append_session_log,
)
from ai_schemas import (
    CardGenerationResponse,
    ConceptMapResponse,
    ReflectionResponse,
    AnkiCard,
    preprocess_fields_json_escapes,
)
from utils.cli import debug

# Manual schema definitions for Gemini API to avoid Pydantic/Protobuf mismatches
# (Gemini SDK does not support 'default', '$defs', 'anyOf', 'additionalProperties', etc.)

_CONCEPT_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "definition": {"type": "string"},
        "category": {"type": "string"},
    },
    "required": ["id", "name", "definition", "category"]
}

_RELATION_SCHEMA = {
    "type": "object",
    "properties": {
        "source": {"type": "string"},
        "target": {"type": "string"},
        "type": {"type": "string"},
        "page_reference": {"type": "string", "nullable": True},
    },
    "required": ["source", "target", "type"]
}

_CONCEPT_MAP_SCHEMA = {
    "type": "object",
    "properties": {
        "objectives": {"type": "array", "items": {"type": "string"}},
        "concepts": {"type": "array", "items": _CONCEPT_SCHEMA},
        "relations": {"type": "array", "items": _RELATION_SCHEMA},
    },
    "required": ["objectives", "concepts", "relations"]
}

_ANKI_CARD_SCHEMA = {
    "type": "object",
    "properties": {
        "model_name": {"type": "string"},
        "fields_json": {
            "type": "string", 
            "description": "JSON object string mapping field names to values (e.g. '{\"Front\": \"...\", \"Back\": \"...\"}')"
        },
        "tags": {"type": "array", "items": {"type": "string"}},
        "slide_topic": {"type": "string", "nullable": True},
        "slide_number": {"type": "integer", "nullable": True},
        "rationale": {"type": "string", "nullable": True},
        "media": {
            "type": "array", 
            "items": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "data": {"type": "string"},
                },
                "required": ["filename", "data"]
            }, 
            "nullable": True
        }
    },
    "required": ["model_name", "fields_json"]
}

_CARD_GENERATION_SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {"type": "array", "items": _ANKI_CARD_SCHEMA},
        "done": {"type": "boolean"},
    },
    "required": ["cards", "done"]
}

_REFLECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "reflection": {"type": "string"},
        "cards": {"type": "array", "items": _ANKI_CARD_SCHEMA},
        "done": {"type": "boolean"},
    },
    "required": ["reflection", "cards", "done"]
}

class LecternAIClient:
    def __init__(
        self, 
        model_name: str | None = None, 
        exam_mode: bool = False,
        slide_set_context: Dict[str, Any] | None = None,
    ) -> None:
        if not config.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")
        
        self._client = genai.Client(
            api_key=config.GEMINI_API_KEY,
            http_options={'api_version': 'v1alpha'}
        )
        
        self._model_id = model_name or config.DEFAULT_GEMINI_MODEL
        self._exam_mode = exam_mode  # Store for use in reflection
        
        # NOTE(Tags): Store slide set context for hierarchical tagging
        # Contains: deck_name, slide_set_name, pattern_info, pdf_title
        self._slide_set_context = slide_set_context or {}
        
        # NOTE(Exam-Mode): Combine base formatting with exam context when exam_mode is enabled
        if exam_mode:
            system_instruction = EXAM_PREP_CONTEXT + LATEX_STYLE_GUIDE + EXAM_EXAMPLES
            debug("[AI] Exam mode ENABLED - prioritizing comparison/application cards")
        else:
            system_instruction = LATEX_STYLE_GUIDE + BASIC_EXAMPLES
        
        self._generation_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=config.GEMINI_GENERATION_TEMPERATURE,  # NOTE(Temperature): Optimized for Gemini 3 structured output (0.8-0.9 range per docs)
            max_output_tokens=8192,
            system_instruction=system_instruction,
            thinking_config=types.ThinkingConfig(thinking_level=config.GEMINI_THINKING_LEVEL.lower()),
            safety_settings=[
                types.SafetySetting(category='HARM_CATEGORY_HARASSMENT', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_HATE_SPEECH', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_DANGEROUS_CONTENT', threshold='BLOCK_NONE'),
            ],
        )
        
        self._chat = self._client.chats.create(
            model=self._model_id,
            config=self._generation_config
        )
        
        self._log_path = _start_session_log()
        debug("[AI] Started session via LecternAIClient (google-genai)")

    @property
    def log_path(self) -> str:
        return self._log_path

    def _build_tag_context(self) -> str:
        """Build the tag instruction context for AI prompts based on slide set context.
        
        Returns a string with tagging instructions that will be inserted into the prompt.
        """
        ctx = self._slide_set_context
        
        if not ctx:
            # Fallback to simple tagging instructions
            return (
                "- Metadata:\\n"
                "    - `tags`: 1-2 concise tags (kebab-case, max 3 words). These will be added to a hierarchical tag structure.\\n"
            )
        
        deck_name = ctx.get('deck_name', '')
        slide_set_name = ctx.get('slide_set_name', '')
        pattern_info = ctx.get('pattern_info', {})
        
        # Build example tag
        example_parts = []
        if deck_name:
            example_parts.append(deck_name.replace(' ', '-').lower()[:30])
        if slide_set_name:
            example_parts.append(slide_set_name.replace(' ', '-').lower()[:30])
        example_parts.append("[slide_topic]")
        example_parts.append("[your-tag]")
        example_tag = "::".join(example_parts)
        
        # Build full context
        existing_sets = pattern_info.get('slide_sets', [])
        existing_context = ""
        if existing_sets:
            sample = existing_sets[:3]
            existing_context = f" Existing slide sets in this deck: {', '.join(sample)}."
        
        return (
            "- Metadata (Hierarchical Tagging System):\\n"
            f"    - Tag Structure: Deck::SlideSet::Topic::Tag (this slide set: '{slide_set_name}'){existing_context}\\n"
            "    - `tags`: 1-2 concise, specific tags (kebab-case, max 3 words) for the LEAF level only.\\n"
            "      Examples: 'preprocessing', 'gradient-descent', 'bias-variance', 'hyperparameter-tuning'\\n"
            f"      Full tag will become: {example_tag}\\n"
            "    - AVOID generic tags like 'definition', 'concept', 'important', 'basics'.\\n"
        )

    def _build_exam_mode_prompt_parts(self) -> Tuple[str, str, float]:
        """Build prompt parts and temperature based on exam mode setting.
        
        Returns:
            Tuple of (principles_text, completion_text, temperature)
        """
        if self._exam_mode:
            principles_text = (
                "- Principles (CRAM MODE):\\n"
                "    - STRICTLY FILTER: If a concept is trivial (e.g. 'Definition of Supervised Learning'), DO NOT create a card.\\n"
                "    - Focus on 'Scenario' (Application) and 'Comparison' cards.\\n"
                "    - Context: Use the `slide_topic` to identify the specific section/topic within the slide set.\\n"
            )
            completion_text = (
                "- Important: Only generate cards for concepts that are EXAM-CRITICAL and NON-OBVIOUS.\\n"
                "- If you have covered the high-yield core of the material, set 'done' to true immediately. Do not pad with filler.\\n"
                "- Return ONLY JSON: {\\\"cards\\\": [...], \\\"done\\\": bool}.\\n"
            )
            gen_temperature = config.GEMINI_EXAM_MODE_TEMPERATURE
        else:
            principles_text = (
                "- Principles:\\n"
                "    - Atomicity: One idea per card.\\n"
                "    - Minimum Information Principle: Keep questions and answers simple and direct.\\n"
                "    - Variety: Mix card types: Definitions, Comparisons (A vs B), Applications (Scenario -> Concept), and 'Why/How' questions.\\n"
                "    - Context: Use the `slide_topic` to identify the specific section/topic within the slide set.\\n"
            )
            completion_text = (
                "- Important: Continue generating cards to cover ALL concepts in the material. Do NOT set 'done' to true until you have exhausted the content.\\n"
                "- Return ONLY JSON: {\\\"cards\\\": [...], \\\"done\\\": bool}. Generate the full limit of cards if possible.\\n"
            )
            gen_temperature = config.GEMINI_NORMAL_MODE_TEMPERATURE
        
        return principles_text, completion_text, gen_temperature

    def _prune_history(self) -> None:
        """Prune chat history to manage token usage (sliding window)."""
        try:
            history = self._chat.history
            if len(history) <= 20:
                return

            new_history = history[:2] + history[-6:]
            # In google-genai, we might need to recreate the chat or update history if permitted
            self._chat._history = new_history
            debug(f"[AI] Pruned history: {len(history)} -> {len(new_history)} items")
        except Exception as e:
            debug(f"[AI] History pruning failed: {e}")

    def concept_map(self, pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
        exam_context = ""
        if self._exam_mode:
            exam_context = (
                "- Focus: EXAM MODE ENABLED. Prioritize concepts that are likely to be tested (definitions, key distinctions, causal relationships). Ignore trivial background info.\\n"
            )

        prompt = (
            "You are an expert educator and knowledge architect. Analyze the following lecture slides to construct a comprehensive global concept map that serves as the backbone for a spaced repetition deck.\\n"
            f"{exam_context}"
            "- Objectives: Extract explicit learning goals and implicit competency targets.\\n"
            "- Concepts: Identify the core entities, theories, and definitions. Prioritize *fundamental* concepts over trivial examples. Assign stable, short, unique IDs.\\n"
            "- Relations: Map the *semantic structure* of the domain. Use precise relation types (e.g., `is_a`, `part_of`, `causes`, `precedes`, `contrasts_with`). Note page references for traceability.\\n"
            "- Formatting: STRICTLY AVOID Markdown (e.g., **bold**). Use HTML tags for formatting (e.g., <b>bold</b>, <i>italic</i>) within any text fields.\\n"
            "Return ONLY a JSON object with keys: objectives (array), concepts (array), relations (array). No prose.\\n"
        )
        
        # Adjust _compose_multimodal_content to return types.Content parts if needed, 
        # but google-genai handles simple dicts/strings well.
        parts = _compose_multimodal_content(pdf_content, prompt)
        debug(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
        
        # Update config for this specific call to include response_schema
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CONCEPT_MAP_SCHEMA,
        })

        response = self._chat.send_message(
            message=parts,
            config=call_config
        )
        
        text = response.text or ""
        debug(f"[Chat/ConceptMap] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "conceptmap", parts, text, True)
        
        # Attempt to fix escape sequences (common in LaTeX content)
        try:
            fixed_text = preprocess_fields_json_escapes(text)
            data_obj = ConceptMapResponse.model_validate_json(fixed_text)
        except Exception as e:
            debug(f"[Chat/ConceptMap] Standard parsing failed, trying aggressive fix: {e}")
            # Aggressive fallback matching other methods
            aggressive_fix = text.replace('\\', '\\\\')
            for char in ['"', 'n', 't', 'r', '/']:
                aggressive_fix = aggressive_fix.replace('\\\\' + char, '\\' + char)
            aggressive_fix = aggressive_fix.replace('\\\\\\\\', '\\\\')
            data_obj = ConceptMapResponse.model_validate_json(aggressive_fix)

        data = data_obj.model_dump()
        return data if isinstance(data, dict) else {"concepts": []}

    def generate_more_cards(
        self,
        limit: int,
        examples: str = "",
        avoid_fronts: List[str] | None = None,
        covered_slides: List[int] | None = None,
        pacing_hint: str = "",
    ) -> Dict[str, Any]:
        self._prune_history()
        example_text = ""
        if examples:
            example_text = f"\\n- Reference Examples (Mimic this style):\\n{examples}\\n"
        avoid_text = ""
        if avoid_fronts:
            trimmed = [f"- {front[:160]}" for front in avoid_fronts[:30]]
            avoid_text = (
                "\\n- Already covered (DO NOT repeat these prompts or cloze texts):\\n"
                + "\\n".join(trimmed)
                + "\\n"
            )
        slide_text = ""
        if covered_slides:
            slide_text = (
                "\\n- Coverage guidance:\\n"
                f"    - Already covered slide numbers: {', '.join(str(s) for s in covered_slides[:80])}.\\n"
                "    - Prefer uncovered slides and topics when possible.\\n"
            )
        
        # NOTE(Pacing): Inject real-time feedback on density
        pacing_text = ""
        if pacing_hint:
            pacing_text = f"\\n- Pacing & Density Feedback:\\n{pacing_hint}\\n"
        
        # NOTE(Tags): Build context string for hierarchical tagging
        tag_context = self._build_tag_context()
        
        # NOTE(Exam-Mode): Use different prompts based on exam_mode setting.
        # Exam mode: aggressive filtering, early termination, scenario/comparison focus.
        # Normal mode: comprehensive coverage, variety of card types, exhaust all content.
        principles_text, completion_text, gen_temperature = self._build_exam_mode_prompt_parts()
        
        prompt = (
            f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\\n"
            "CRITICAL: Consult the Global Concept Map generated in the first turn. Ensure you cover the 'Relations' identified there.\\n"
            f"{pacing_text}"
            f"{example_text}"
            f"{principles_text}"
            "- Format:\\n"
            "    - Prefer Cloze deletion for definitions and lists.\\n"
            "    - Use Basic (Front/Back) for open-ended conceptual questions.\\n"
            "    - Text Formatting: STRICTLY AVOID Markdown (e.g., **bold**). Use HTML tags for formatting (e.g., <b>bold</b>, <i>italic</i>, <code>code</code>).\\n"
            f"{tag_context}"
            f"{avoid_text}"
            f"{slide_text}"
            "    - `slide_topic`: The specific section/topic within this slide set (Title Case, e.g., 'Image Classification', 'Gradient Descent').\\n"
            "    - `slide_number`: The integer page number where this concept is primarily found.\\n"
            "    - `rationale`: A brief (1 sentence) explanation of why this card is valuable.\\n"
            f"{completion_text}"
        )
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CARD_GENERATION_SCHEMA,
            "temperature": gen_temperature,
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        debug(f"[Chat/Gen] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "generation", [{"text": prompt}], text, True)
        
        # Try multiple parsing strategies
        data_obj = None
        parse_strategy = "none"
        
        # Strategy 1: Standard preprocessing
        try:
            fixed_text = preprocess_fields_json_escapes(text)
            data_obj = CardGenerationResponse.model_validate_json(fixed_text)
            parse_strategy = "standard"
        except Exception as e1:
            debug(f"[Chat/Gen] Standard parsing failed: {e1}")
            
            # Strategy 2: Aggressive backslash normalization
            try:
                # Replace all backslashes with double backslashes, then fix valid escapes
                aggressive_fix = text.replace('\\', '\\\\')
                # Restore valid JSON escapes: after doubling, \" became \\", \n became \\n, etc.
                # We need to restore them to single-backslash form for valid JSON.
                # Search: 2 backslashes + char → Replace: 1 backslash + char
                for char in ['"', 'n', 't', 'r', '/']:
                    aggressive_fix = aggressive_fix.replace('\\\\' + char, '\\' + char)
                # Special case: escaped backslash \\ became \\\\ after doubling, restore to \\
                aggressive_fix = aggressive_fix.replace('\\\\\\\\', '\\\\')
                data_obj = CardGenerationResponse.model_validate_json(aggressive_fix)
                parse_strategy = "aggressive"
                debug("[Chat/Gen] Aggressive parsing succeeded")
            except Exception as e2:
                debug(f"[Chat/Gen] Aggressive parsing failed: {e2}")
                
                # Strategy 3: Try to extract whatever valid cards we can
                try:
                    import re
                    # Extract cards array manually
                    cards_match = re.search(r'"cards"\s*:\s*\[(.*)\]', text, re.DOTALL)
                    if cards_match:
                        # Return an empty but valid structure so generation can continue
                        debug("[Chat/Gen] Falling back to empty cards due to parse errors")
                        data_obj = CardGenerationResponse(cards=[], done=False)
                        parse_strategy = "fallback_empty"
                except Exception as e3:
                    debug(f"[Chat/Gen] All parsing strategies failed: {e3}")
                    raise e1  # Re-raise original error
        
        if data_obj is None:
            return {"cards": [], "done": True}
            
        data = data_obj.model_dump()

        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            # Direct usage of Pydantic-validated cards
            done = bool(data.get("done", len(cards) == 0))
            return {"cards": cards, "done": done}
        return {"cards": [], "done": True}

    def reflect(self, limit: int, reflection_prompt: str | None = None) -> Dict[str, Any]:
        self._prune_history()
        
        # NOTE(Exam-Mode): Use specialized reflection prompt when exam mode is enabled
        if self._exam_mode:
            base = (
                EXAM_REFLECTION_CONTEXT +
                "Review the last batch of generated cards with the above priorities in mind.\\n"
                "- Write a concise `reflection` summarizing quality issues found.\\n"
                "- Generate improved replacements or gap-filling cards.\\n"
                "- IMPORTANT: In the `rationale` field of the new card, state 'REPLACEMENT FOR: [Old Card Concept]' so it can be deduplicated.\\n"
                "- Formatting: STRICTLY AVOID Markdown. Use HTML tags for formatting.\\n"
                f"Return ONLY JSON: {{\"reflection\": str, \"cards\": [...], \"done\": bool}}. Limit to at most {int(limit)} cards.\\n"
            )
        else:
            base = (
                "You are a strict Quality Assurance Specialist for educational content. Review the last batch of generated cards.\\n"
                "- Critique Criteria:\\n"
                "    - Redundancy: Are there duplicate or overlapping cards?\\n"
                "    - Vagueness: Is the question ambiguous without more context?\\n"
                "    - Complexity: Is the answer too long or multi-faceted? (Split it!)\\n"
                "    - Interference: Do any cards look too similar, causing confusion?\\n"
                "- Action:\\n"
                "    - Write a concise `reflection` summarizing the quality and identifying specific issues.\\n"
                "    - Generate improved replacements or new gap-filling cards to address the issues.\\n"
                "    - Formatting: STRICTLY AVOID Markdown (e.g., **bold**). Use HTML tags for formatting (e.g., <b>bold</b>, <i>italic</i>).\\n"
                f"Return ONLY JSON: {{\"reflection\": str, \"cards\": [...], \"done\": bool}}. Limit to at most {int(limit)} cards.\\n"
            )
        prompt = (reflection_prompt or base)
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _REFLECTION_SCHEMA,
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        debug(f"[Chat/Reflect] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "reflection", [{"text": prompt}], text, True)

        data_obj = None
        parse_strategy = "none"
        try:
            fixed_text = preprocess_fields_json_escapes(text)
            data_obj = ReflectionResponse.model_validate_json(fixed_text)
            parse_strategy = "standard"
        except Exception as e1:
            debug(f"[Chat/Reflect] Standard parsing failed: {e1}")
            try:
                aggressive_fix = text.replace('\\', '\\\\')
                for char in ['"', 'n', 't', 'r', '/']:
                    aggressive_fix = aggressive_fix.replace('\\\\' + char, '\\' + char)
                aggressive_fix = aggressive_fix.replace('\\\\\\\\', '\\\\')
                data_obj = ReflectionResponse.model_validate_json(aggressive_fix)
                parse_strategy = "aggressive"
                debug("[Chat/Reflect] Aggressive parsing succeeded")
            except Exception as e2:
                debug(f"[Chat/Reflect] Aggressive parsing failed: {e2}")
                data_obj = ReflectionResponse(reflection="", cards=[], done=True)
                parse_strategy = "fallback_empty"

        debug(f"[Chat/Reflect] Parse strategy: {parse_strategy}")
        data = data_obj.model_dump()

        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", False)) or (len(cards) == 0)
            return {"reflection": str(data.get("reflection", "")), "cards": cards, "done": done}
        return {"reflection": "", "cards": [], "done": True}

    def get_history(self) -> List[Dict[str, Any]]:
        """Export chat history as a list of dicts."""
        # google-genai history is a list of types.Content objects
        # We need to serialize them.
        serialized = []
        try:
            for item in self._chat.history:
                # Use model_dump for Pydantic models in google-genai
                serialized.append(item.model_dump(exclude_none=True))
        except Exception as e:
            debug(f"[AI] Failed to serialize history: {e}")
            return []
        return serialized

    def restore_history(self, history: List[Dict[str, Any]]) -> None:
        """Restore chat history from a list of dicts."""
        try:
            # Re-create chat with history
            # Convert list of dicts back to types.Content
            parsed_history = [types.Content(**item) for item in history]
            self._chat = self._client.chats.create(
                model=self._model_id,
                config=self._generation_config,
                history=parsed_history
            )
            debug(f"[AI] Restored history with {len(history)} turns")
        except Exception as e:
            debug(f"[AI] Failed to restore history: {e}")

    def count_tokens(self, content: List[Dict[str, Any]]) -> int:
        """Count tokens for a given content list."""
        try:
            # google-genai count_tokens uses model.count_tokens
            # content should be converted to types.Content if it's a list of dicts
            parsed_content = [types.Content(**c) if isinstance(c, dict) else c for c in content]
            response = self._client.models.count_tokens(
                model=self._model_id,
                contents=parsed_content,
                config=self._generation_config
            )
            return response.total_tokens
        except Exception as e:
            debug(f"[AI] Token counting failed: {e}")
            return 0
