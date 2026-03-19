from __future__ import annotations

from typing import Protocol, TypedDict


class CardFields(TypedDict, total=False):
    Front: str
    Back: str
    Text: str


class CardData(TypedDict, total=False):
    uid: str
    _uid: str
    model_name: str
    front: str
    back: str
    text: str
    fields: CardFields
    slide_number: str | int
    source_pages: list[int]
    concept_ids: list[str]
    relation_keys: list[str]
    quality_score: float
    quality_flags: list[str]


class ConceptData(TypedDict, total=False):
    id: str
    name: str
    importance: str
    page_references: list[int]


class RelationData(TypedDict, total=False):
    source: str
    target: str
    type: str
    page_references: list[int]


class ConceptMapData(TypedDict, total=False):
    objectives: list[str]
    concepts: list[ConceptData]
    relations: list[RelationData]
    language: str
    slide_set_name: str
    page_count: int
    estimated_text_chars: int
    document_type: str


class CoverageEntityRef(TypedDict, total=False):
    id: str
    name: str


class CoverageData(TypedDict, total=False):
    covered_pages: list[int]
    uncovered_pages: list[int]
    page_coverage_pct: float
    covered_page_count: int
    total_pages: int
    missing_high_priority: list[CoverageEntityRef]
    uncovered_concepts: list[CoverageEntityRef]
    uncovered_relations: list[CoverageEntityRef]
    high_priority_total: int
    high_priority_covered: int
    explicit_concept_count: int
    explicit_concept_coverage_pct: float
    explicit_relation_count: int
    relation_coverage_pct: float
    total_relations: int


class GenerationResponse(TypedDict, total=False):
    cards: list[CardData]
    done: bool
    parse_error: str


class ReflectionResponse(TypedDict, total=False):
    reflection: str
    cards: list[CardData]
    done: bool
    parse_error: str


class OrchestratorAIClient(Protocol):
    @property
    def log_path(self) -> str: ...

    async def upload_document(self, pdf_path: str) -> object: ...

    async def build_concept_map(
        self,
        *,
        file_uri: str,
        mime_type: str = "application/pdf",
    ) -> ConceptMapData: ...

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
    ) -> GenerationResponse: ...

    async def reflect_cards(
        self,
        *,
        limit: int,
        all_card_fronts: list[str] | None = None,
        cards_to_refine_json: str = "",
        coverage_gaps: str = "",
    ) -> ReflectionResponse: ...

    def set_slide_set_context(self, *, deck_name: str, slide_set_name: str) -> None: ...

    def drain_warnings(self) -> list[str]: ...
