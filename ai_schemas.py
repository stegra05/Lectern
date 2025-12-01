from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
import json

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
    fields: Dict[str, str] = {}
    tags: List[str] = []
    slide_topic: Optional[str] = None
    rationale: Optional[str] = Field(None, description="Brief explanation of why this card is valuable")
    media: Optional[List[Dict[str, Any]]] = None

    @model_validator(mode='before')
    @classmethod
    def parse_json_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # If AI returns fields_json (string), parse it into fields (dict)
            if 'fields_json' in data:
                try:
                    data['fields'] = json.loads(data.pop('fields_json'))
                except Exception:
                    # Fallback or let validation fail if fields is missing
                    pass
        return data

class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool

class ReflectionResponse(BaseModel):
    reflection: str
    cards: List[AnkiCard]
    done: bool
