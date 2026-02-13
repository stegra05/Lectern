from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Literal, Optional, Type
from pydantic import BaseModel, Field


class Concept(BaseModel):
    id: str
    name: str
    definition: str
    category: str
    importance: Literal["high", "medium", "low"]
    difficulty: Literal["foundational", "intermediate", "advanced"]


class Relation(BaseModel):
    source: str
    target: str
    type: str
    page_reference: Optional[str] = None


class ConceptMapResponse(BaseModel):
    objectives: List[str]
    concepts: List[Concept]
    relations: List[Relation]
    language: Optional[str] = None
    slide_set_name: Optional[str] = None
    page_count: Optional[int] = None
    estimated_text_chars: Optional[int] = None


class FieldPair(BaseModel):
    name: str
    value: Optional[str] = None


class AnkiCard(BaseModel):
    """Gemini-facing card schema: list-of-fields is most stable."""
    model_name: str = Field(description="The Anki note type, either 'Basic' or 'Cloze'")
    fields: List[FieldPair] = Field(default_factory=list)
    slide_topic: Optional[str] = None
    slide_number: Optional[str] = None
    rationale: Optional[str] = Field(None, description="Brief explanation of why this card is valuable")


class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool = False


class ReflectionResponse(BaseModel):
    reflection: str = ""
    cards: List[AnkiCard]
    done: bool = False


def _schema_for(model: Type[BaseModel]) -> Dict[str, Any]:
    return model.model_json_schema()


@lru_cache
def concept_map_schema() -> Dict[str, Any]:
    return _schema_for(ConceptMapResponse)


@lru_cache
def card_generation_schema() -> Dict[str, Any]:
    return _schema_for(CardGenerationResponse)


@lru_cache
def reflection_schema() -> Dict[str, Any]:
    return _schema_for(ReflectionResponse)
