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

class AnkiCard(BaseModel):
    model_name: str = Field(description="The Anki note type, either 'Basic' or 'Cloze'")
    fields: Dict[str, str]
    tags: List[str] = []
    slide_topic: Optional[str] = None
    media: Optional[List[Dict[str, Any]]] = None

class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool

class ReflectionResponse(BaseModel):
    reflection: str
    cards: List[AnkiCard]
    done: bool
