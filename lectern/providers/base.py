"""Provider interfaces for AI backends."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class AIProvider(Protocol):
    """Provider contract used by generation orchestration."""

    @property
    def log_path(self) -> str: ...

    async def upload_document(self, pdf_path: str) -> Any: ...

    async def build_concept_map(
        self,
        *,
        file_uri: str,
        mime_type: str = "application/pdf",
    ) -> dict[str, Any]: ...

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
    ) -> dict[str, Any]: ...

    async def reflect_cards(
        self,
        *,
        limit: int,
        all_card_fronts: list[str] | None = None,
        cards_to_refine_json: str = "",
        coverage_gaps: str = "",
    ) -> dict[str, Any]: ...

    def set_slide_set_context(self, *, deck_name: str, slide_set_name: str) -> None: ...

    def drain_warnings(self) -> list[str]: ...
