from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from google import genai  # type: ignore
from google.genai import types  # type: ignore

import config
from ai_common import (
    _compose_multimodal_content,
    _compose_native_file_content,
    _start_session_log,
    _append_session_log,
)
from ai_prompts import PromptBuilder, PromptConfig
from ai_schemas import (
    CardGenerationResponse,
    ConceptMapResponse,
    ReflectionResponse,
    AnkiCard,
    card_generation_schema,
    concept_map_schema,
    reflection_schema,
)
import logging
logger = logging.getLogger(__name__)

_THINKING_PROFILES = {
    "concept_map": "high",
    "generation": "low",
    "reflection": "high",
}

_CONCEPT_MAP_SCHEMA = concept_map_schema()
_CARD_GENERATION_SCHEMA = card_generation_schema()
_REFLECTION_SCHEMA = reflection_schema()

_MAX_OUTPUT_TOKENS = 8192
_HISTORY_PRUNE_THRESHOLD = 20
_HISTORY_PRUNE_HEAD = 2
_HISTORY_PRUNE_TAIL = 6
_ROLLING_SUMMARY_MAX_FRONTS = 200
_ROLLING_SUMMARY_FRONT_TRUNC = 120

class LecternAIClient:
    def __init__(
        self,
        model_name: str | None = None,
        focus_prompt: str | None = None,
        slide_set_context: Dict[str, Any] | None = None,
        language: str = "en",
    ) -> None:
        """
        Initialize the Gemini AI client.

        Args:
            model_name: Overrides the default model if provided.
            focus_prompt: Optional user instruction to guide generation.
            slide_set_context: Optional context from a previous generation (concept map etc.)
            language: Target language for generation (e.g., 'en', 'de')
        """
        self._api_key = config.GEMINI_API_KEY
        if not self._api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables or keychain.")

        self._model_name = model_name or config.DEFAULT_GEMINI_MODEL
        self._client = genai.Client(api_key=self._api_key)

        self._slide_set_context: Dict[str, Any] = {}
        if slide_set_context:
            self.set_slide_set_context(
                deck_name=str(slide_set_context.get("deck_name") or ""),
                slide_set_name=str(slide_set_context.get("slide_set_name") or ""),
            )

        # Initialize prompt builder
        self._prompt_config = PromptConfig(language=language, focus_prompt=focus_prompt)
        self._prompt_builder = PromptBuilder(self._prompt_config)

        # Initialize history
        self._history: List[Dict[str, Any]] = []

        # System instruction
        system_inst = self._prompt_builder.system

        self._generation_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=config.GEMINI_TEMPERATURE,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            system_instruction=system_inst,
            safety_settings=[
                types.SafetySetting(category='HARM_CATEGORY_HARASSMENT', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_HATE_SPEECH', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold='BLOCK_NONE'),
                types.SafetySetting(category='HARM_CATEGORY_DANGEROUS_CONTENT', threshold='BLOCK_NONE'),
            ],
        )
        
        self._chat = self._client.chats.create(
            model=self._model_name,
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

    def _thinking_config_for(self, phase: str) -> types.ThinkingConfig:
        level = _THINKING_PROFILES.get(phase, "low")
        return types.ThinkingConfig(thinking_level=level)

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        self._slide_set_context = {
            "deck_name": deck_name,
            "slide_set_name": slide_set_name,
        }

    def _build_rolling_card_summary(self, all_card_fronts: List[str]) -> str:
        cleaned_fronts = [" ".join(str(front).split()) for front in all_card_fronts if str(front).strip()]
        if not cleaned_fronts:
            return ""

        omitted_count = 0
        if len(cleaned_fronts) > _ROLLING_SUMMARY_MAX_FRONTS:
            omitted_count = len(cleaned_fronts) - _ROLLING_SUMMARY_MAX_FRONTS
            cleaned_fronts = cleaned_fronts[-_ROLLING_SUMMARY_MAX_FRONTS:]

        summary_lines = [
            "Rolling summary of previously generated card fronts.",
            "Use this to avoid repetition with earlier batches.",
        ]
        if omitted_count > 0:
            summary_lines.append(
                f"Only the latest 200 fronts are listed ({omitted_count} earlier cards omitted)."
            )

        for idx, front in enumerate(cleaned_fronts, start=1):
            summary_lines.append(f"{idx}. {front[:_ROLLING_SUMMARY_FRONT_TRUNC]}")

        return "\n".join(summary_lines)

    def _prune_history(self, all_card_fronts: List[str] | None = None) -> None:
        """Prune chat history to manage token usage (sliding window)."""
        try:
            history = self.get_history()
            if len(history) <= _HISTORY_PRUNE_THRESHOLD:
                return

            summary_text = self._build_rolling_card_summary(all_card_fronts or [])
            summary_turn: List[Dict[str, Any]] = []
            if summary_text:
                summary_turn = [
                    {
                        "role": "user",
                        "parts": [
                            {"text": "Summarize generated coverage so far before continuing."}
                        ],
                    },
                    {
                        "role": "model",
                        "parts": [{"text": summary_text}],
                    },
                ]

            new_history = (
                history[:_HISTORY_PRUNE_HEAD]
                + summary_turn
                + history[-_HISTORY_PRUNE_TAIL:]
            )
            self.restore_history(new_history)
            logger.debug(f"[AI] Pruned history: {len(history)} -> {len(new_history)} items")
        except Exception as e:
            logger.debug(f"[AI] History pruning failed: {e}")

    def _with_retry(self, operation_name: str, fn: Any, retries: int = 3, base_delay_s: float = 1.0) -> Any:
        """Execute a callable with exponential backoff."""
        for attempt in range(1, retries + 1):
            try:
                return fn()
            except Exception as exc:
                if attempt == retries:
                    raise RuntimeError(
                        f"{operation_name} failed after {retries} attempts: {exc}"
                    ) from exc
                sleep_seconds = base_delay_s * (2 ** (attempt - 1))
                logger.warning(
                    "[AI] %s attempt %s/%s failed: %s; retrying in %.1fs",
                    operation_name,
                    attempt,
                    retries,
                    exc,
                    sleep_seconds,
                )
                time.sleep(sleep_seconds)

    def upload_pdf(self, pdf_path: str, retries: int = 3) -> Dict[str, str]:
        """Upload a PDF to Gemini Files API and return metadata."""
        def _upload() -> Any:
            return self._client.files.upload(file=pdf_path)

        uploaded = self._with_retry("PDF upload", _upload, retries=retries)
        uri = str(getattr(uploaded, "uri", "") or "")
        mime_type = str(getattr(uploaded, "mime_type", "") or "application/pdf")
        if not uri:
            raise RuntimeError("PDF upload returned no URI.")
        return {"uri": uri, "mime_type": mime_type}

    def _concept_map_for_parts(self, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CONCEPT_MAP_SCHEMA,
            "thinking_config": self._thinking_config_for("concept_map"),
        })

        response = self._chat.send_message(
            message=parts,
            config=call_config
        )

        text = response.text or ""
        text_snippet = text[:200].replace('\n', ' ')
        logger.debug(f"[Chat/ConceptMap] Response snippet: {text_snippet}...")
        _append_session_log(self._log_path, "conceptmap", parts, text, True)

        data = self._safe_parse_json(text, ConceptMapResponse)
        if isinstance(data, dict):
            detected_lang = data.get("language")
            if detected_lang:
                self.update_language(detected_lang)
            return data
        return {"concepts": []}

    def concept_map_from_file(self, file_uri: str, mime_type: str = "application/pdf") -> Dict[str, Any]:
        prompt = self._prompt_builder.concept_map()
        parts = _compose_native_file_content(file_uri=file_uri, prompt=prompt, mime_type=mime_type)
        logger.debug(f"[Chat/ConceptMap] native parts={len(parts)} prompt_len={len(prompt)}")
        return self._concept_map_for_parts(parts)

    def concept_map(self, pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = self._prompt_builder.concept_map()
        
        parts = _compose_multimodal_content(pdf_content, prompt)
        logger.debug(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
        return self._concept_map_for_parts(parts)

    def count_tokens_for_pdf(self, *, file_uri: str, prompt: str, mime_type: str = "application/pdf", retries: int = 3) -> int:
        content = _compose_native_file_content(file_uri=file_uri, prompt=prompt, mime_type=mime_type)

        def _count() -> int:
            return self.count_tokens(content)

        return int(self._with_retry("Token counting", _count, retries=retries))

    def generate_more_cards(
        self,
        limit: int,
        examples: str = "",
        avoid_fronts: List[str] | None = None,
        covered_slides: List[int] | None = None,
        pacing_hint: str = "",
        all_card_fronts: List[str] | None = None,
    ) -> Dict[str, Any]:
        self._prune_history(all_card_fronts=all_card_fronts)
        
        # Build context strings
        avoid_text = ""
        if avoid_fronts:
            trimmed = [f"- {front[:100]}" for front in avoid_fronts[:20]]
            avoid_text = "\\n- Avoid re-generating:\\n" + "\\n".join(trimmed) + "\\n"
            
        slide_text = ""
        if covered_slides:
            slide_text = f"\\n- Already covered slides: {', '.join(str(s) for s in covered_slides[:50])}...\\n"
            
        # Use PromptBuilder
        prompt = self._prompt_builder.generation(
            limit=limit,
            pacing_hint=pacing_hint,
            avoid_text=avoid_text,
            slide_coverage=slide_text
        )
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _CARD_GENERATION_SCHEMA,
            "temperature": config.GEMINI_TEMPERATURE,
            "thinking_config": self._thinking_config_for("generation"),
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        text_snippet = text[:200].replace('\n', ' ')
        logger.debug(f"[Chat/Gen] Response snippet: {text_snippet}...")
        _append_session_log(self._log_path, "generation", [{"text": prompt}], text, True)
        
        data = self._safe_parse_json(text, CardGenerationResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", len(cards) == 0))
            return {"cards": cards, "done": done}
        return {"cards": [], "done": True}

    def reflect(
        self,
        limit: int,
        reflection_prompt: str | None = None,
        all_card_fronts: List[str] | None = None,
    ) -> Dict[str, Any]:
        self._prune_history(all_card_fronts=all_card_fronts)
        
        prompt = reflection_prompt or self._prompt_builder.reflection(limit=limit)
        
        call_config = self._generation_config.model_copy(update={
            "response_schema": _REFLECTION_SCHEMA,
            "thinking_config": self._thinking_config_for("reflection"),
        })

        response = self._chat.send_message(
            message=prompt,
            config=call_config
        )
        
        text = response.text or ""
        text_snippet = text[:200].replace('\n', ' ')
        logger.debug(f"[Chat/Reflect] Response snippet: {text_snippet}...")
        _append_session_log(self._log_path, "reflection", [{"text": prompt}], text, True)

        data = self._safe_parse_json(text, ReflectionResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", False)) or (len(cards) == 0)
            return {"reflection": str(data.get("reflection", "")), "cards": cards, "done": done}
        return {"reflection": "", "cards": [], "done": True}

    def _safe_parse_json(self, text: str, model_class: Any) -> Dict[str, Any] | None:
        """Parse JSON response from AI."""
        try:
            data_obj = model_class.model_validate_json(text)
            data_dict = data_obj.model_dump()
            
            # Post-processing: Convert list of fields back to dict for compatibility
            # This handles AnkiCard inside CardGenerationResponse or ReflectionResponse
            if "cards" in data_dict:
                for card in data_dict["cards"]:
                    if isinstance(card.get("fields"), list):
                        new_fields = {}
                        for field_item in card["fields"]:
                            if isinstance(field_item, dict) and "name" in field_item and "value" in field_item:
                                if field_item["value"] is not None:
                                    new_fields[field_item["name"]] = field_item["value"]
                        card["fields"] = new_fields
                        
            return data_dict
        except Exception as e:
            logger.warning("[AI] JSON parsing failed: %s", e)
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
                model=self._model_name,
                config=self._generation_config,
                history=parsed_history
            )
            logger.debug(f"[AI] Restored history with {len(history)} turns")
        except Exception as e:
            logger.debug(f"[AI] Failed to restore history: {e}")

    def count_tokens(self, content: List[Any]) -> int:
        """Count tokens for a given content list."""
        try:
            parsed_content = [types.Content(**c) if isinstance(c, dict) else c for c in content]
            response = self._client.models.count_tokens(
                model=self._model_name,
                contents=parsed_content,
                # config=self._generation_config  # NOTE: generating config (with system_instruction) breaks count_tokens
            )
            return response.total_tokens
        except Exception as e:
            logger.debug(f"[AI] Token counting failed: {e}")
            return 0
