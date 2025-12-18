from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from google import genai  # type: ignore
from google.genai import types  # type: ignore

import config
from ai_common import (
    LATEX_STYLE_GUIDE,
    _compose_multimodal_content,
    _start_session_log,
    _append_session_log,
)
from ai_schemas import CardGenerationResponse, ConceptMapResponse, ReflectionResponse, AnkiCard
from ai_cards import _normalize_card_object
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
    def __init__(self, model_name: str | None = None) -> None:
        if not config.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")
        
        self._client = genai.Client(
            api_key=config.GEMINI_API_KEY,
            http_options={'api_version': 'v1alpha'}
        )
        
        self._model_id = model_name or config.DEFAULT_GEMINI_MODEL
        
        self._generation_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
            max_output_tokens=8192,
            system_instruction=LATEX_STYLE_GUIDE,
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
        prompt = (
            "You are an expert educator and knowledge architect. Analyze the following lecture slides to construct a comprehensive global concept map that serves as the backbone for a spaced repetition deck.\\n"
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
        
        try:
            data_obj = ConceptMapResponse.model_validate_json(text)
            data = data_obj.model_dump()
        except Exception:
            return {"concepts": []}
        return data if isinstance(data, dict) else {"concepts": []}

    def generate_more_cards(self, limit: int, examples: str = "") -> Dict[str, Any]:
        self._prune_history()
        example_text = ""
        if examples:
            example_text = f"\\n- Reference Examples (Mimic this style):\\n{examples}\\n"
        
        prompt = (
            f"Generate up to {int(limit)} high-quality, atomic Anki notes continuing from our prior turns.\\n"
            f"{example_text}"
            "- Principles:\\n"
            "    - Atomicity: One idea per card.\\n"
            "    - Minimum Information Principle: Keep questions and answers simple and direct.\\n"
            "    - Variety: Mix card types: Definitions, Comparisons (A vs B), Applications (Scenario -> Concept), and 'Why/How' questions.\\n"
            "    - Context: Use the `slide_topic` to ground the card.\\n"
            "- Format:\\n"
            "    - Prefer Cloze deletion for definitions and lists.\\n"
            "    - Use Basic (Front/Back) for open-ended conceptual questions.\\n"
            "    - Text Formatting: STRICTLY AVOID Markdown (e.g., **bold**). Use HTML tags for formatting (e.g., <b>bold</b>, <i>italic</i>, <code>code</code>).\\n"
            "- Metadata:\\n"
            "    - `tags`: 1-2 concise, hierarchical tags (kebab-case, max 3 words). Avoid generic terms.\\n"
            "    - `slide_topic`: The specific section/header (Title Case).\\n"
            "    - `slide_number`: The integer page number where this concept is primarily found.\\n"
            "    - `rationale`: A brief (1 sentence) explanation of why this card is valuable.\\n"
            "- Important: Continue generating cards to cover ALL concepts in the material. Do NOT set 'done' to true until you have exhausted the content.\\n"
            "- Return ONLY JSON: {\\\"cards\\\": [...], \\\"done\\\": bool}. Generate the full limit of cards if possible.\\n"
        )
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CARD_GENERATION_SCHEMA,
            "temperature": 0.4,
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        debug(f"[Chat/Gen] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "generation", [{"text": prompt}], text, True)
        
        try:
            data_obj = CardGenerationResponse.model_validate_json(text)
            data = data_obj.model_dump()
        except Exception:
            return {"cards": [], "done": True}

        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            normalized = [_normalize_card_object(c) for c in cards]
            normalized = [c for c in normalized if c]
            done = bool(data.get("done", len(normalized) == 0))
            return {"cards": normalized, "done": done}
        return {"cards": [], "done": True}

    def reflect(self, limit: int, reflection_prompt: str | None = None) -> Dict[str, Any]:
        self._prune_history()
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
        
        try:
            data_obj = ReflectionResponse.model_validate_json(text)
            data = data_obj.model_dump()
        except Exception:
            return {"reflection": "", "cards": [], "done": True}

        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            normalized = [_normalize_card_object(c) for c in cards]
            normalized = [c for c in normalized if c]
            done = bool(data.get("done", False)) or (len(normalized) == 0)
            return {"reflection": str(data.get("reflection", "")), "cards": normalized, "done": done}
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
