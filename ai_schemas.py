from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class Concept(BaseModel):
    id: str
    name: str
    definition: str
    category: str


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


class AnkiCard(BaseModel):
    """Anki card model. Now receives 'fields' directly as a dict from AI."""
    model_name: str = Field(description="The Anki note type, either 'Basic' or 'Cloze'")
    fields: List[Dict[str, str]] = []  # List of {name: "Front", value: "..."}
    tags: List[str] = []
    slide_topic: Optional[str] = None
    rationale: Optional[str] = Field(None, description="Brief explanation of why this card is valuable")
    media: Optional[List[Dict[str, Any]]] = None


class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool


class ReflectionResponse(BaseModel):
    reflection: str
    cards: List[AnkiCard]
    done: bool
