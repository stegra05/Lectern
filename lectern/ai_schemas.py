from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Literal, Optional, Type
from pydantic import BaseModel, Field, field_validator, model_validator

from lectern.coverage import normalize_page_references, normalize_string_list


class Concept(BaseModel):
    id: str
    name: str
    definition: str
    category: str
    importance: Literal["high", "medium", "low"]
    difficulty: Literal["foundational", "intermediate", "advanced"]
    page_references: List[int] = Field(default_factory=list)

    @field_validator("page_references", mode="before")
    @classmethod
    def normalize_page_refs(cls, value: Any) -> Any:
        return normalize_page_references(value)


class Relation(BaseModel):
    source: str
    target: str
    type: str
    page_reference: Optional[str] = None
    page_references: List[int] = Field(default_factory=list)

    @field_validator("page_references", mode="before")
    @classmethod
    def normalize_page_refs(cls, value: Any) -> Any:
        return normalize_page_references(value)


class ConceptMapResponse(BaseModel):
    objectives: List[str]
    concepts: List[Concept]
    relations: List[Relation]
    language: Optional[str] = None
    slide_set_name: Optional[str] = None
    page_count: Optional[int] = None
    estimated_text_chars: Optional[int] = None
    document_type: Optional[Literal["script", "slides", "mixed"]] = Field(None, description="Classify the document's density and structure: 'script' for text-dense books/papers, 'slides' for visual-heavy presentations.")


class FieldPair(BaseModel):
    name: str
    value: Optional[str] = None


class AnkiCard(BaseModel):
    model_name: str = Field(description="The Anki note type, either 'Basic' or 'Cloze'")
    fields: List[FieldPair] = Field(default_factory=list)
    slide_topic: Optional[str] = None
    slide_number: Optional[str] = None
    source_pages: List[int] = Field(default_factory=list)
    concept_ids: List[str] = Field(default_factory=list)
    relation_keys: List[str] = Field(default_factory=list)
    rationale: Optional[str] = Field(None, description="Brief explanation of why this card is valuable")
    source_excerpt: Optional[str] = Field(None, description="Short grounded excerpt or paraphrase from the source slide")

    @field_validator("model_name", mode="before")
    @classmethod
    def titleize_model_name(cls, v: Any) -> Any:
        if isinstance(v, str):
            v_lower = v.strip().lower()
            if v_lower == "basic": return "Basic"
            if v_lower == "cloze": return "Cloze"
            return v.strip().title()
        return v

    @field_validator("slide_number", mode="before")
    @classmethod
    def stringify_slide_number(cls, v: Any) -> Any:
        if isinstance(v, (int, float)):
            if v < 1 or v > 99999:
                return None
            return str(int(v))
        if isinstance(v, str):
            v_strip = v.strip()
            if v_strip.isdigit() and len(v_strip) <= 5:
                return v_strip
            return None
        return v

    @field_validator("source_pages", mode="before")
    @classmethod
    def normalize_source_pages(cls, value: Any) -> Any:
        return normalize_page_references(value)

    @field_validator("concept_ids", mode="before")
    @classmethod
    def normalize_concept_ids(cls, value: Any) -> Any:
        return normalize_string_list(value)

    @field_validator("relation_keys", mode="before")
    @classmethod
    def normalize_relation_keys(cls, value: Any) -> Any:
        return normalize_string_list(value)

    @model_validator(mode="before")
    @classmethod
    def coerce_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        
        fields = data.get("fields")
        if isinstance(fields, dict):
            data["fields"] = [{"name": str(k), "value": (None if v is None else str(v))} for k, v in fields.items()]
        elif not isinstance(fields, list):
            model_name = str(data.get("model_name", "")).lower()
            if model_name == "cloze":
                text = str(data.get("text") or "").strip()
                if text:
                    data["fields"] = [{"name": "Text", "value": text}]
            else:
                front = str(data.get("front") or "").strip()
                back = str(data.get("back") or "").strip()
                gen_fields = []
                if front: gen_fields.append({"name": "Front", "value": front})
                if back: gen_fields.append({"name": "Back", "value": back})
                if gen_fields:
                    data["fields"] = gen_fields
        return data


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
