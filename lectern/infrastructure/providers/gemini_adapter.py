from __future__ import annotations

from typing import Any

from lectern.application.ports import AIProviderPort
from lectern.domain_types import ConceptMapData
from lectern.providers.base import AIProvider
from lectern.providers.gemini_provider import GeminiProvider


class GeminiAdapter(AIProviderPort):
    """Adapter mapping AIProvider contract into v2 application port shape."""

    def __init__(self, *, provider: AIProvider | None = None) -> None:
        self._provider = provider or GeminiProvider()

    async def upload_document(self, pdf_path: str) -> Any:
        return await self._provider.upload_document(pdf_path)

    async def build_concept_map(self, file_uri: str, mime_type: str) -> ConceptMapData:
        result = await self._provider.build_concept_map(
            file_uri=file_uri,
            mime_type=mime_type,
        )
        return result if isinstance(result, dict) else {}

    async def generate_cards(self, *, limit: int, context: Any) -> dict[str, Any]:
        payload = context if isinstance(context, dict) else {}
        result = await self._provider.generate_cards(
            limit=limit,
            examples=str(payload.get("examples") or ""),
            avoid_fronts=list(payload.get("avoid_fronts") or []),
            covered_slides=list(payload.get("covered_slides") or []),
            pacing_hint=str(payload.get("pacing_hint") or ""),
            all_card_fronts=list(payload.get("all_card_fronts") or []),
            coverage_gap_text=str(payload.get("coverage_gap_text") or ""),
        )
        mapped = dict(result) if isinstance(result, dict) else {}
        mapped["warnings"] = self._provider.drain_warnings()
        return mapped

    async def reflect_cards(self, *, limit: int, context: Any) -> dict[str, Any]:
        payload = context if isinstance(context, dict) else {}
        result = await self._provider.reflect_cards(
            limit=limit,
            all_card_fronts=list(payload.get("all_card_fronts") or []),
            cards_to_refine_json=str(payload.get("cards_to_refine_json") or ""),
            coverage_gaps=str(payload.get("coverage_gaps") or ""),
        )
        mapped = dict(result) if isinstance(result, dict) else {}
        mapped["warnings"] = self._provider.drain_warnings()
        return mapped

    def drain_warnings(self) -> list[str]:
        return self._provider.drain_warnings()
