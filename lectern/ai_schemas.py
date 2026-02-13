from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any, Dict, List, Literal, Optional, Type, Union
from pydantic import BaseModel, Field, field_validator


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


class _CardBase(BaseModel):
    slide_number: int = Field(ge=1)
    slide_topic: str = Field(min_length=1, max_length=120)
    rationale: Optional[str] = Field(
        None,
        max_length=320,
        description="Optional one-sentence explanation of card value.",
    )

    @field_validator("slide_topic", "rationale", mode="before")
    @classmethod
    def _strip_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class BasicCard(_CardBase):
    model_name: Literal["Basic"]
    front: str = Field(min_length=1, max_length=280)
    back: str = Field(min_length=1, max_length=1400)

    @field_validator("front", "back", mode="before")
    @classmethod
    def _strip_front_back(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class ClozeCard(_CardBase):
    model_name: Literal["Cloze"]
    text: str = Field(min_length=1, max_length=1400)

    @field_validator("text", mode="before")
    @classmethod
    def _strip_text_field(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


AnkiCard = Annotated[Union[BasicCard, ClozeCard], Field(discriminator="model_name")]


class GeminiCard(BaseModel):
    """Gemini-facing response schema (no oneOf/discriminator)."""
    model_name: Literal["Basic", "Cloze"]
    front: Optional[str] = Field(None, max_length=280)
    back: Optional[str] = Field(None, max_length=1400)
    text: Optional[str] = Field(None, max_length=1400)
    slide_number: int = Field(ge=1)
    slide_topic: str = Field(min_length=1, max_length=120)


class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool = False


class ReflectionResponse(BaseModel):
    reflection: str = ""
    cards: List[AnkiCard]
    done: bool = False


class GeminiCardGenerationResponse(BaseModel):
    cards: List[GeminiCard]
    done: bool = False


class GeminiReflectionResponse(BaseModel):
    reflection: str = ""
    cards: List[GeminiCard]
    done: bool = False


def _schema_for(model: Type[BaseModel]) -> Dict[str, Any]:
    return model.model_json_schema()


@lru_cache
def concept_map_schema() -> Dict[str, Any]:
    return _schema_for(ConceptMapResponse)


@lru_cache
def card_generation_schema() -> Dict[str, Any]:
    return _schema_for(GeminiCardGenerationResponse)


@lru_cache
def reflection_schema() -> Dict[str, Any]:
    return _schema_for(GeminiReflectionResponse)
