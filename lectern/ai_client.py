from __future__ import annotations

import os
import random
import re
import time
import asyncio
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Type

from google import genai  # type: ignore
from google.genai import types  # type: ignore
from pydantic import BaseModel

from lectern import config
from lectern.ai_common import (
    _compose_multimodal_content,
    _compose_native_file_content,
    _start_session_log,
    _append_session_log,
)
from lectern.ai_prompts import PromptBuilder, PromptConfig
from lectern.ai_schemas import (
    CardGenerationResponse,
    ConceptMapResponse,
    RepairCardResponse,
    ReflectionResponse,
    card_generation_schema,
    concept_map_schema,
    repair_card_schema,
    reflection_schema,
)
import logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UploadedDocument:
    """Result of uploading a document to Gemini Files API."""

    uri: str
    mime_type: str = "application/pdf"
    duration_ms: int = 0
    retries: int = 0
    file_size_bytes: int | None = None


class DocumentUploadError(Exception):
    """Raised when document upload fails after all retries."""

    def __init__(
        self,
        message: str,
        *,
        user_message: str,
        original_error: Exception | None = None,
    ):
        super().__init__(message)
        self.user_message = user_message
        self.original_error = original_error


# Rate limiting configuration
RATE_LIMIT_MAX_RETRIES = 5
RATE_LIMIT_BASE_DELAY = 2.0  # seconds
RATE_LIMIT_MAX_DELAY = 60.0  # seconds
RATE_LIMIT_JITTER_FACTOR = 0.1  # 10% jitter

_THINKING_PROFILES = {
    "concept_map": "high",
    "generation": "low",
    "reflection": "high",
}

# Pre-compiled regex patterns for rate limit retry parsing
_RETRY_AFTER_PATTERN = re.compile(r'retry_after["\'\s:=]+(\d+(?:\.\d+)?)', re.IGNORECASE)
_RETRY_IN_PATTERN = re.compile(r"retry\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*s", re.IGNORECASE)

# Models known NOT to support thinking budgets.
_THINKING_BLOCKED_PATTERNS = (
    "gemini-1.5",
    "gemini-2.0-flash-lite",
)


def _model_supports_thinking(model_name: str) -> bool:
    """Heuristic: return False for model families that reject thinking_level."""
    name = model_name.lower()
    return not any(pat in name for pat in _THINKING_BLOCKED_PATTERNS)


_CONCEPT_MAP_SCHEMA = concept_map_schema()
_CARD_GENERATION_SCHEMA = card_generation_schema()
_REFLECTION_SCHEMA = reflection_schema()
_REPAIR_CARD_SCHEMA = repair_card_schema()


def coerce_response_dict(payload: Any) -> dict[str, Any]:
    """Return a structured response dict or an empty fallback."""
    return payload if isinstance(payload, dict) else {}


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
            raise ValueError(
                "GEMINI_API_KEY not found in environment variables or keychain."
            )

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
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            system_instruction=system_inst,
            safety_settings=[
                types.SafetySetting(
                    category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"
                ),
            ],
        )

        self._chat: Any = self._client.aio.chats.create(
            model=self._model_name, config=self._generation_config
        )
        self._thinking_supported: bool = _model_supports_thinking(self._model_name)
        self._warnings: list[str] = []
        self._last_parse_error: str = ""

        self._log_path = _start_session_log()
        logger.info(
            "[AI] Session init: model=%s, thinking=%s, genai=%s",
            self._model_name,
            self._thinking_supported,
            genai.__version__,
        )

    @staticmethod
    def _normalize_card_payload(
        payload: Dict[str, Any], raw_payload: Dict[str, Any] | None = None
    ) -> Dict[str, Any]:
        """Normalize model card payload to app-facing shape."""
        if "cards" not in payload:
            return payload

        cards = payload.get("cards")
        if not isinstance(cards, list):
            return payload

        for card in cards:
            if not isinstance(card, dict):
                continue

            fields = card.get("fields")
            if isinstance(fields, list):
                mapped: Dict[str, str] = {}
                for item in fields:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or "").strip()
                    value = item.get("value")
                    if name and value is not None:
                        mapped[name] = str(value)
                card["fields"] = mapped

            slide_number = card.get("slide_number")
            if (
                isinstance(slide_number, str)
                and slide_number.strip().isdigit()
                and len(slide_number.strip()) <= 5
            ):
                card["slide_number"] = int(slide_number.strip())

        # Preserve extra fields not present in Gemini-facing schema.
        if raw_payload and isinstance(raw_payload.get("cards"), list):
            for res_card, raw_card in zip(cards, raw_payload["cards"]):
                if isinstance(res_card, dict) and isinstance(raw_card, dict):
                    for key, value in raw_card.items():
                        if key not in res_card:
                            res_card[key] = value
        return payload

    def _validate_structured_payload(
        self,
        payload: Any,
        model_class: Type[BaseModel],
        raw_payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any] | None:
        """Validate parsed payload with Pydantic and normalize app-facing fields."""
        self._last_parse_error = ""
        try:
            data_obj = model_class.model_validate(payload)
            result = data_obj.model_dump()
            return self._normalize_card_payload(result, raw_payload=raw_payload)
        except Exception as exc:
            self._last_parse_error = str(exc)
            logger.warning("[AI] Structured response validation failed: %s", exc)
            return None

    def _parse_structured_response(
        self,
        response: Any,
        model_class: Type[BaseModel],
    ) -> Dict[str, Any] | None:
        """Prefer SDK parsed output, then strict JSON text fallback."""
        self._last_parse_error = ""

        parsed_payload = getattr(response, "parsed", None)
        if parsed_payload is not None:
            parsed_result = self._validate_structured_payload(
                parsed_payload, model_class
            )
            if parsed_result is not None:
                return parsed_result

        text = (getattr(response, "text", "") or "").strip()
        if not text:
            self._last_parse_error = "Gemini returned an empty response body."
            logger.warning("[AI] %s", self._last_parse_error)
            return None

        try:
            raw_payload = json.loads(text)
        except Exception as exc:
            self._last_parse_error = str(exc)
            logger.warning("[AI] JSON parsing failed: %s", exc)
            return None

        return self._validate_structured_payload(
            raw_payload, model_class, raw_payload=raw_payload
        )

    @property
    def log_path(self) -> str:
        return self._log_path

    def update_language(self, language: str) -> None:
        """Update the prompt builder language and refresh system instruction."""
        if language and language != self._prompt_config.language:
            logger.info(f"[AI] Updating output language to: {language}")
            self._prompt_config.language = language

    def _thinking_config_for(self, phase: str) -> types.ThinkingConfig | None:
        if not self._thinking_supported:
            return None
        level = _THINKING_PROFILES.get(phase, "low")
        return types.ThinkingConfig(thinking_level=level)

    def drain_warnings(self) -> list[str]:
        """Return and clear any accumulated warnings (e.g. thinking fallback)."""
        warnings = self._warnings
        self._warnings = []
        return warnings

    @staticmethod
    def _strip_thinking(call_config: Any) -> Any:
        """Return a copy of *call_config* with thinking_config fully removed."""
        fields = call_config.model_dump(exclude_none=True)
        fields.pop("thinking_config", None)
        return type(call_config)(**fields)

    async def _send_with_thinking_fallback(self, message: Any, call_config: Any) -> Any:
        """Send a message; if thinking_level is rejected, retry without it."""
        has_thinking = call_config.thinking_config is not None
        logger.debug(
            "[AI] send_message: model=%s, thinking=%s, config_keys=%s",
            self._model_name,
            has_thinking,
            [k for k, v in call_config.model_dump(exclude_none=True).items()],
        )
        try:
            return await self._chat.send_message(message=message, config=call_config)
        except Exception as exc:
            err_text = str(exc).lower()
            # Catch known "thinking parameter not supported" or INVALID_ARGUMENT related to it
            is_thinking_error = "thinking" in err_text and (
                "not supported" in err_text or "invalid_argument" in err_text
            )

            if is_thinking_error:
                logger.warning(
                    "[AI] thinking_level rejected (model=%s, genai=%s): %s",
                    self._model_name,
                    genai.__version__,
                    err_text[:200],
                )
                self._thinking_supported = False
                self._warnings.append(
                    "Extended thinking is not supported by this model. "
                    "Continuing without it — results may be less thorough."
                )
                clean_config = self._strip_thinking(call_config)
                return await self._chat.send_message(
                    message=message, config=clean_config
                )
            raise

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        self._slide_set_context = {
            "deck_name": deck_name,
            "slide_set_name": slide_set_name,
        }

    def _build_rolling_card_summary(self, all_card_fronts: List[str]) -> str:
        cleaned_fronts = [
            " ".join(str(front).split())
            for front in all_card_fronts
            if str(front).strip()
        ]
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

    def _prune_history(self, all_card_fronts: List[str] | None = None) -> str:
        """Prune chat history to manage token usage (sliding window).

        Returns a rolling coverage summary string to be injected into the next prompt.
        """
        try:
            history = self.get_history()
            if len(history) <= _HISTORY_PRUNE_THRESHOLD:
                return ""

            summary_text = self._build_rolling_card_summary(all_card_fronts or [])

            new_history = history[:_HISTORY_PRUNE_HEAD] + history[-_HISTORY_PRUNE_TAIL:]
            self.restore_history(new_history)
            logger.debug(
                f"[AI] Pruned history: {len(history)} -> {len(new_history)} items"
            )
            return (
                f"\n- GENERATION PROGRESS SO FAR:\n{summary_text}\n"
                if summary_text
                else ""
            )
        except Exception as e:
            logger.debug(f"[AI] History pruning failed: {e}")
            return ""

    def _is_rate_limit_error(self, exc: Exception) -> bool:
        """Check if an exception indicates a rate limit error."""
        err_text = str(exc).lower()
        # Check for common rate limit indicators
        rate_limit_patterns = [
            "429",
            "rate limit",
            "quota exceeded",
            "resource_exhausted",
            "too many requests",
            "rate_limit",
            "retry_after",
        ]
        return any(pattern in err_text for pattern in rate_limit_patterns)

    def _extract_retry_after(self, exc: Exception) -> float | None:
        """Extract Retry-After value from exception if available."""
        err_text = str(exc)
        # Try to find retry_after in the error message
        match = _RETRY_AFTER_PATTERN.search(err_text)
        if match:
            return float(match.group(1))
        # Try to find "retry in X seconds" pattern
        match = _RETRY_IN_PATTERN.search(err_text)
        if match:
            return float(match.group(1))
        return None

    def _calculate_backoff_with_jitter(self, base_delay: float, attempt: int) -> float:
        """Calculate backoff delay with exponential increase and jitter."""
        # Exponential backoff
        delay = base_delay * (2 ** (attempt - 1))
        # Cap at max delay
        delay = min(delay, RATE_LIMIT_MAX_DELAY)
        # Add jitter (random +/- 10%)
        jitter = delay * RATE_LIMIT_JITTER_FACTOR * random.uniform(-1, 1)
        delay = max(0.1, delay + jitter)
        return delay

    async def _with_retry(
        self,
        operation_name: str,
        fn: Any,
        retries: int = RATE_LIMIT_MAX_RETRIES,
        base_delay_s: float = RATE_LIMIT_BASE_DELAY,
    ) -> Any:
        """Execute an async callable with exponential backoff and rate limit handling."""
        last_exception: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                return await fn()
            except Exception as exc:
                last_exception = exc

                # Check if it's a rate limit error
                is_rate_limit = self._is_rate_limit_error(exc)

                if attempt == retries:
                    error_type = "Rate limit" if is_rate_limit else "Operation"
                    raise RuntimeError(
                        f"{error_type} {operation_name} failed after {retries} attempts: {exc}"
                    ) from exc

                # Calculate delay
                if is_rate_limit:
                    # Try to get Retry-After header value
                    retry_after = self._extract_retry_after(exc)
                    if retry_after:
                        sleep_seconds = retry_after
                    else:
                        sleep_seconds = self._calculate_backoff_with_jitter(
                            base_delay_s, attempt
                        )
                    logger.warning(
                        "[AI] %s rate limited (attempt %d/%d); waiting %.1fs before retry: %s",
                        operation_name,
                        attempt,
                        retries,
                        sleep_seconds,
                        str(exc)[:200],
                    )
                else:
                    # Standard exponential backoff for other errors
                    sleep_seconds = base_delay_s * (2 ** (attempt - 1))
                    logger.warning(
                        "[AI] %s attempt %d/%d failed: %s; retrying in %.1fs",
                        operation_name,
                        attempt,
                        retries,
                        str(exc)[:200],
                        sleep_seconds,
                    )

                await asyncio.sleep(sleep_seconds)

        # Should not reach here, but satisfy type checker
        raise RuntimeError(f"{operation_name} failed: {last_exception}")

    async def upload_document(
        self,
        pdf_path: str,
        retries: int = 3,
        validate_file: bool = True,
    ) -> UploadedDocument:
        """Upload a PDF to Gemini Files API with full error handling and timing.

        Args:
            pdf_path: Path to the PDF file to upload.
            retries: Number of retry attempts for transient failures.
            validate_file: If True, validate file exists and is non-empty before upload.

        Returns:
            UploadedDocument with upload metadata including timing and retry count.

        Raises:
            DocumentUploadError: If upload fails after all retries or file is invalid.
        """
        # Pre-validation
        if validate_file:
            if not os.path.exists(pdf_path):
                raise DocumentUploadError(
                    f"File not found: {pdf_path}",
                    user_message=f"The file could not be found: {os.path.basename(pdf_path)}",
                )
            file_size = os.path.getsize(pdf_path)
            if file_size == 0:
                raise DocumentUploadError(
                    f"File is empty (0 bytes): {pdf_path}",
                    user_message="The uploaded file is empty (0 bytes).",
                )
        else:
            file_size = None

        start_time = time.perf_counter()
        # Note: attempt_count relies on _with_retry calling _upload sequentially.
        # If _with_retry is ever parallelized, this will need to be made thread-safe.
        attempt_count = 0

        async def _upload() -> Any:
            nonlocal attempt_count
            attempt_count += 1
            return await self._client.aio.files.upload(file=pdf_path)

        try:
            uploaded = await self._with_retry("PDF upload", _upload, retries=retries)
        except Exception as exc:
            raise DocumentUploadError(
                f"PDF upload failed after {retries} attempts: {exc}",
                user_message=f"Failed to upload the PDF. Please try again. ({type(exc).__name__})",
                original_error=exc,
            ) from exc

        uri = str(getattr(uploaded, "uri", "") or "")
        mime_type = str(getattr(uploaded, "mime_type", "") or "application/pdf")
        duration_ms = int((time.perf_counter() - start_time) * 1000)

        if not uri:
            raise DocumentUploadError(
                "PDF upload returned no URI.",
                user_message="The upload completed but returned an invalid response.",
            )

        return UploadedDocument(
            uri=uri,
            mime_type=mime_type,
            duration_ms=duration_ms,
            retries=max(0, attempt_count - 1),
            file_size_bytes=file_size,
        )

    async def _concept_map_for_parts(
        self, parts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        update: dict[str, Any] = {"response_schema": _CONCEPT_MAP_SCHEMA}
        thinking = self._thinking_config_for("concept_map")
        if thinking is not None:
            update["thinking_config"] = thinking
        call_config = self._generation_config.model_copy(update=update)

        response = await self._send_with_thinking_fallback(parts, call_config)

        text = response.text or ""
        text_snippet = text[:200].replace("\n", " ")
        logger.debug(f"[Chat/ConceptMap] Response snippet: {text_snippet}...")
        _append_session_log(self._log_path, "conceptmap", parts, text, True)

        data = self._parse_structured_response(response, ConceptMapResponse)
        if isinstance(data, dict):
            detected_lang = data.get("language")
            if detected_lang:
                self.update_language(detected_lang)
            return data
        return {"concepts": []}

    async def concept_map_from_file(
        self,
        file_uri: str,
        mime_type: str = "application/pdf",
    ) -> Dict[str, Any]:
        prompt = self._prompt_builder.concept_map()
        parts = _compose_native_file_content(
            file_uri=file_uri, prompt=prompt, mime_type=mime_type
        )
        logger.debug(
            f"[Chat/ConceptMap] native parts={len(parts)} prompt_len={len(prompt)}"
        )
        return await self._concept_map_for_parts(parts)

    async def concept_map(self, pdf_content: List[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = self._prompt_builder.concept_map()

        parts = _compose_multimodal_content(pdf_content, prompt)
        logger.debug(f"[Chat/ConceptMap] parts={len(parts)} prompt_len={len(prompt)}")
        return await self._concept_map_for_parts(parts)

    async def count_tokens_for_pdf(
        self,
        *,
        file_uri: str,
        prompt: str,
        mime_type: str = "application/pdf",
        retries: int = 3,
    ) -> int:
        content = _compose_native_file_content(
            file_uri=file_uri, prompt=prompt, mime_type=mime_type
        )

        async def _count() -> int:
            return await self.count_tokens(content)

        return int(await self._with_retry("Token counting", _count, retries=retries))

    async def generate_more_cards(
        self,
        limit: int,
        examples: str = "",
        avoid_fronts: List[str] | None = None,
        covered_slides: List[int] | None = None,
        pacing_hint: str = "",
        all_card_fronts: List[str] | None = None,
        coverage_gap_text: str = "",
    ) -> Dict[str, Any]:
        coverage_summary = self._prune_history(all_card_fronts=all_card_fronts)

        # Build context strings
        avoid_text = ""
        if avoid_fronts:
            trimmed = [f"- {front[:100]}" for front in avoid_fronts[:20]]
            avoid_text = "\n- Avoid re-generating:\n" + "\n".join(trimmed) + "\n"

        slide_text = ""
        if covered_slides:
            slide_text = f"\n- Already covered slides: {', '.join(str(s) for s in covered_slides[:50])}...\n"

        examples_text = ""
        if examples.strip():
            examples_text = (
                "\n- Style anchor from the user's deck. Match the granularity and tone, but never copy content verbatim:\n"
                f"{examples.strip()}\n"
            )

        # Use PromptBuilder
        prompt = self._prompt_builder.generation(
            limit=limit,
            pacing_hint=pacing_hint,
            avoid_text=avoid_text,
            slide_coverage=slide_text,
            coverage_summary=f"{coverage_gap_text}{coverage_summary}",
            examples_text=examples_text,
        )

        update: dict[str, Any] = {
            "response_schema": _CARD_GENERATION_SCHEMA,
        }
        thinking = self._thinking_config_for("generation")
        if thinking is not None:
            update["thinking_config"] = thinking
        call_config = self._generation_config.model_copy(update=update)

        response = await self._send_with_thinking_fallback(prompt, call_config)

        text = response.text or ""
        text_snippet = text[:200].replace("\n", " ")
        logger.debug(f"[Chat/Gen] Response snippet: {text_snippet}...")
        _append_session_log(
            self._log_path, "generation", [{"text": prompt}], text, True
        )

        data = self._parse_structured_response(response, CardGenerationResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", len(cards) == 0))
            return {"cards": cards, "done": done, "parse_error": ""}
        return {"cards": [], "done": True, "parse_error": self._last_parse_error}

    async def reflect(
        self,
        limit: int,
        reflection_prompt: str | None = None,
        all_card_fronts: List[str] | None = None,
        cards_to_refine_json: str = "",
        coverage_gaps: str = "",
    ) -> Dict[str, Any]:
        self._prune_history(all_card_fronts=all_card_fronts)

        prompt = reflection_prompt or self._prompt_builder.reflection(
            limit=limit,
            cards_to_refine=cards_to_refine_json,
            coverage_gaps=coverage_gaps,
        )

        update: dict[str, Any] = {"response_schema": _REFLECTION_SCHEMA}
        thinking = self._thinking_config_for("reflection")
        if thinking is not None:
            update["thinking_config"] = thinking
        call_config = self._generation_config.model_copy(update=update)

        response = await self._send_with_thinking_fallback(prompt, call_config)

        text = response.text or ""
        text_snippet = text[:200].replace("\n", " ")
        logger.debug(f"[Chat/Reflect] Response snippet: {text_snippet}...")
        _append_session_log(
            self._log_path, "reflection", [{"text": prompt}], text, True
        )

        data = self._parse_structured_response(response, ReflectionResponse)
        if isinstance(data, dict):
            cards = [c for c in data.get("cards", []) if isinstance(c, dict)]
            done = bool(data.get("done", False)) or (len(cards) == 0)
            return {
                "reflection": str(data.get("reflection", "")),
                "cards": cards,
                "done": done,
                "parse_error": "",
            }
        return {
            "reflection": "",
            "cards": [],
            "done": True,
            "parse_error": self._last_parse_error,
        }

    async def repair_card(
        self,
        *,
        card: dict[str, Any],
        reasons: list[str],
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Repair one card using provider-guided grounding/provenance reasons."""
        payload = card if isinstance(card, dict) else {}
        reason_text = ", ".join(str(item) for item in reasons if str(item).strip())
        strict = bool((context or {}).get("strict"))

        prompt = self._prompt_builder.repair(
            card_json=json.dumps(payload, ensure_ascii=False),
            reasons=reason_text,
            strict=strict,
        )

        update: dict[str, Any] = {"response_schema": _REPAIR_CARD_SCHEMA}
        thinking = self._thinking_config_for("reflection")
        if thinking is not None:
            update["thinking_config"] = thinking
        call_config = self._generation_config.model_copy(update=update)

        response = await self._send_with_thinking_fallback(prompt, call_config)

        text = response.text or ""
        _append_session_log(self._log_path, "repair", [{"text": prompt}], text, True)

        parsed = self._parse_structured_response(response, RepairCardResponse)
        if isinstance(parsed, dict):
            repaired_card = parsed.get("card")
            if isinstance(repaired_card, dict):
                return {"card": repaired_card, "parse_error": ""}

        return {"card": {}, "parse_error": self._last_parse_error}

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
            self._chat = self._client.aio.chats.create(
                model=self._model_name,
                config=self._generation_config,
                history=parsed_history,
            )
            logger.debug(f"[AI] Restored history with {len(history)} turns")
        except Exception as e:
            logger.debug(f"[AI] Failed to restore history: {e}")

    async def count_tokens(self, content: List[Any]) -> int:
        """Count tokens for a given content list."""
        try:
            parsed_content = [
                types.Content(**c) if isinstance(c, dict) else c for c in content
            ]
            response = await self._client.aio.models.count_tokens(
                model=self._model_name,
                contents=parsed_content,
                # config=self._generation_config  # NOTE: generating config (with system_instruction) breaks count_tokens
            )
            return response.total_tokens
        except Exception as e:
            logger.debug(f"[AI] Token counting failed: {e}")
            return 0
