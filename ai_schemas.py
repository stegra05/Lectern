from typing import TypedDict, List, Optional

class Concept(TypedDict):
    id: str
    name: str
    definition: str
    category: str

class Relation(TypedDict):
    source: str
    target: str
    type: str
    page_reference: Optional[str]

class ConceptMapResponse(TypedDict):
    objectives: List[str]
    concepts: List[Concept]
    relations: List[Relation]

class Card(TypedDict):
    front: str
    back: str
    text: str
    tags: List[str]
    slide_topic: str

class CardGenerationResponse(TypedDict):
    cards: List[Card]
    done: bool

class ReflectionResponse(TypedDict):
    reflection: str
    cards: List[Card]
    done: bool
