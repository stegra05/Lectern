"""Gemini provider adapter implementing the AIProvider protocol."""

from __future__ import annotations

from typing import Any

from lectern.ai_client import LecternAIClient, coerce_response_dict
from lectern.providers.base import AIProvider


class GeminiProvider(AIProvider):
    """Adapter exposing the provider contract over the Gemini client."""

    def __init__(
        self,
        *,
        client: LecternAIClient | None = None,
        model_name: str | None = None,
        focus_prompt: str | None = None,
        slide_set_context: dict[str, Any] | None = None,
        language: str = "en",
    ) -> None:
        self._client = client or LecternAIClient(
            model_name=model_name,
            focus_prompt=focus_prompt,
            slide_set_context=slide_set_context,
            language=language,
        )

    @property
    def log_path(self) -> str:
        return self._client.log_path

    async def upload_document(self, pdf_path: str) -> Any:
        return await self._client.upload_document(pdf_path)

    async def build_concept_map(
        self,
        *,
        file_uri: str | None = None,
        mime_type: str = "application/pdf",
        pdf_content: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if file_uri:
            result = await self._client.concept_map_from_file(
                file_uri=file_uri,
                mime_type=mime_type,
            )
        else:
            result = await self._client.concept_map(pdf_content or [])
        return coerce_response_dict(result)

    async def generate_cards(
        self,
        *,
        limit: int,
        examples: str = "",
        avoid_fronts: list[str] | None = None,
        covered_slides: list[int] | None = None,
        pacing_hint: str = "",
        all_card_fronts: list[str] | None = None,
        coverage_gap_text: str = "",
    ) -> dict[str, Any]:
        result = await self._client.generate_more_cards(
            limit=limit,
            examples=examples,
            avoid_fronts=avoid_fronts,
            covered_slides=covered_slides,
            pacing_hint=pacing_hint,
            all_card_fronts=all_card_fronts,
            coverage_gap_text=coverage_gap_text,
        )
        return coerce_response_dict(result)

    async def reflect_cards(
        self,
        *,
        limit: int,
        all_card_fronts: list[str] | None = None,
        cards_to_refine_json: str = "",
        coverage_gaps: str = "",
    ) -> dict[str, Any]:
        result = await self._client.reflect(
            limit=limit,
            all_card_fronts=all_card_fronts,
            cards_to_refine_json=cards_to_refine_json,
            coverage_gaps=coverage_gaps,
        )
        return coerce_response_dict(result)

    def set_slide_set_context(self, *, deck_name: str, slide_set_name: str) -> None:
        self._client.set_slide_set_context(
            deck_name=deck_name, slide_set_name=slide_set_name
        )

    def drain_warnings(self) -> list[str]:
        return self._client.drain_warnings()
