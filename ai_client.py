from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple, Optional

from google import genai  # type: ignore
from google.genai import types  # type: ignore

import config
from ai_common import (
    _compose_multimodal_content,
    _start_session_log,
    _append_session_log,
)
from ai_prompts import PromptBuilder, PromptConfig
from ai_schemas import (
    CardGenerationResponse,
    ConceptMapResponse,
    ReflectionResponse,
    AnkiCard,
    preprocess_fields_json_escapes,
)
import logging
logger = logging.getLogger(__name__)

# Manual schema definitions for Gemini API

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
        "language": {
            "type": "string",
            "description": "ISO 639-1 code of primary document language (e.g., 'en', 'de', 'fr')"
        }
    },
    "required": ["objectives", "concepts", "relations", "language"]
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
        language: str = "en",
    ) -> None:
        if not config.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set. Export it before running Lectern.")
        
        self._client = genai.Client(
            api_key=config.GEMINI_API_KEY,
            http_options={'api_version': 'v1alpha'}
        )
        
        self._model_id = model_name or config.DEFAULT_GEMINI_MODEL
        self._exam_mode = exam_mode
        self._slide_set_context = slide_set_context or {}
        
        # Initialize PromptBuilder
        self._prompt_config = PromptConfig(language=language, exam_mode=exam_mode)
        self._prompts = PromptBuilder(self._prompt_config)
        
        system_instruction = self._prompts.system
        
        if exam_mode:
            logger.debug("[AI] Exam mode ENABLED - prioritizing comparison/application cards")
        
        self._generation_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=config.GEMINI_GENERATION_TEMPERATURE,
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
        logger.debug(f"[AI] Started session via LecternAIClient (google-genai)")

    @property
    def log_path(self) -> str:
        return self._log_path

    def update_language(self, language: str) -> None:
        """Update the prompt builder language and refresh system instruction."""
        if language and language != self._prompt_config.language:
            logger.info(f"[AI] Updating output language to: {language}")
            self._prompt_config.language = language
            # We can't easily update the system instruction of an active chat in 
            # google-genai without creating a new chat or sending it as a new message.
            # However, for the *next* turns, we can rely on the repetitive nature of our prompts
            # which now include the language instruction in generation/reflection methods too.
            # 
            # Ideally, we would recreate the chat, but that loses history.
            # For now, we rely on the per-turn prompts in PromptBuilder to enforce it 
            # if session was already started.

    def _build_tag_context(self) -> str:
        """Build the tag instruction context for AI prompts."""
        ctx = self._slide_set_context
        if not ctx:
            return "- Metadata: tags (1-2 concise tags).\\n"
        
        deck_name = ctx.get('deck_name', '')
        slide_set_name = ctx.get('slide_set_name', '')
        pattern_info = ctx.get('pattern_info', {})
        
        # Build example tag string
        parts = []
        if deck_name: parts.append(deck_name.replace(' ', '-').lower()[:20])
        if slide_set_name: parts.append(slide_set_name.replace(' ', '-').lower()[:20])
        parts.append("[topic]")
        example_tag = "::".join(parts)
        
        existing_sets = pattern_info.get('slide_sets', [])
        existing_context = f" (Existing sets: {', '.join(existing_sets[:3])})" if existing_sets else ""
        
        return (
            f"- Metadata (Hierarchical Tagging):\\n"
            f"    - Structure: Deck::SlideSet::Topic::Tag {existing_context}\\n"
            f"    - Example: {example_tag}\\n"
        )

    def _prune_history(self) -> None:
        """Prune chat history to manage token usage (sliding window)."""
        try:
            history = self.get_history()
            if len(history) <= 20:
                return

            new_history = history[:2] + history[-6:]
            self.restore_history(new_history)
            logger.debug(f"[AI] Pruned history: {len(history)} -> {len(new_history)} items")
        except Exception as e:
            logger.debug(f"[AI] History pruning failed: {e}")

    def concept_map(self, pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = self._prompts.concept_map()
        
        parts = _compose_multimodal_content(pdf_content, prompt)
        logger.debug(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CONCEPT_MAP_SCHEMA,
        })

        response = self._chat.send_message(
            message=parts,
            config=call_config
        )
        
        text = response.text or ""
        logger.debug(f"[Chat/ConceptMap] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "conceptmap", parts, text, True)
        
        data = self._safe_parse_json(text, ConceptMapResponse)
        if isinstance(data, dict):
             # Detect and update language from AI response
            detected_lang = data.get("language")
            if detected_lang:
                self.update_language(detected_lang)
            return data
        return {"concepts": []}

    def generate_more_cards(
        self,
        limit: int,
        examples: str = "",
        avoid_fronts: List[str] | None = None,
        covered_slides: List[int] | None = None,
        pacing_hint: str = "",
    ) -> Dict[str, Any]:
        self._prune_history()
        
        # Build context strings
        avoid_text = ""
        if avoid_fronts:
            trimmed = [f"- {front[:100]}" for front in avoid_fronts[:20]]
            avoid_text = "\\n- Avoid re-generating:\\n" + "\\n".join(trimmed) + "\\n"
            
        slide_text = ""
        if covered_slides:
            slide_text = f"\\n- Already covered slides: {', '.join(str(s) for s in covered_slides[:50])}...\\n"
            
        tag_context = self._build_tag_context()
        
        # Use PromptBuilder
        prompt = self._prompts.generation(
            limit=limit,
            pacing_hint=pacing_hint,
            avoid_text=avoid_text,
            tag_context=tag_context,
            slide_coverage=slide_text
        )
        
        # Temperature adjustment
        gen_temperature = config.GEMINI_EXAM_MODE_TEMPERATURE if self._exam_mode else config.GEMINI_NORMAL_MODE_TEMPERATURE
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CARD_GENERATION_SCHEMA,
            "temperature": gen_temperature,
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        logger.debug(f"[Chat/Gen] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "generation", [{"text": prompt}], text, True)
        
        data = self._safe_parse_json(text, CardGenerationResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", len(cards) == 0))
            return {"cards": cards, "done": done}
        return {"cards": [], "done": True}

    def reflect(self, limit: int, reflection_prompt: str | None = None) -> Dict[str, Any]:
        self._prune_history()
        
        prompt = reflection_prompt or self._prompts.reflection(limit=limit)
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _REFLECTION_SCHEMA,
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        logger.debug(f"[Chat/Reflect] Response snippet: {text[:200].replace('\\n',' ')}...")
        _append_session_log(self._log_path, "reflection", [{"text": prompt}], text, True)

        data = self._safe_parse_json(text, ReflectionResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", False)) or (len(cards) == 0)
            return {"reflection": str(data.get("reflection", "")), "cards": cards, "done": done}
        return {"reflection": "", "cards": [], "done": True}

    def _safe_parse_json(self, text: str, model_class: Any) -> Dict[str, Any] | None:
        """Helper to parse JSON with multiple fallback strategies."""
        try:
            fixed_text = preprocess_fields_json_escapes(text)
            data_obj = model_class.model_validate_json(fixed_text)
            return data_obj.model_dump()
        except Exception as e1:
            logger.debug(f"[AI] Standard parsing failed: {e1}")
            try:
                # Aggressive backslash fixing
                aggressive = text.replace('\\', '\\\\')
                for char in ['"', 'n', 't', 'r', '/']:
                    aggressive = aggressive.replace('\\\\' + char, '\\' + char)
                aggressive = aggressive.replace('\\\\\\\\', '\\\\')
                data_obj = model_class.model_validate_json(aggressive)
                return data_obj.model_dump()
            except Exception as e2:
                logger.debug(f"[AI] Aggressive parsing failed: {e2}")
                return None

    def get_history(self) -> List[Dict[str, Any]]:
        """Export chat history as a list of dicts."""
        serialized = []
        try:
            for item in self._chat.history:
                serialized.append(item.model_dump(exclude_none=True))
        except Exception as e:
            logger.debug(f"[AI] Failed to serialize history: {e}")
            return []
        return serialized

    def restore_history(self, history: List[Dict[str, Any]]) -> None:
        """Restore chat history from a list of dicts."""
        try:
            parsed_history = [types.Content(**item) for item in history]
            self._chat = self._client.chats.create(
                model=self._model_id,
                config=self._generation_config,
                history=parsed_history
            )
            logger.debug(f"[AI] Restored history with {len(history)} turns")
        except Exception as e:
            logger.debug(f"[AI] Failed to restore history: {e}")

    def count_tokens(self, content: List[Dict[str, Any]]) -> int:
        """Count tokens for a given content list."""
        try:
            parsed_content = [types.Content(**c) if isinstance(c, dict) else c for c in content]
            response = self._client.models.count_tokens(
                model=self._model_id,
                contents=parsed_content,
                config=self._generation_config
            )
            return response.total_tokens
        except Exception as e:
            logger.debug(f"[AI] Token counting failed: {e}")
            return 0
