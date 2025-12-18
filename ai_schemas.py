from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
import json
import re


def _fix_escape_sequences(s: str) -> str:
    """
    Sanitize invalid JSON escape sequences in a string.
    
    Escapes lone backslashes that are NOT part of valid JSON escapes
    by doubling them. Valid escapes: backslash, quote, slash, b, f, n, r, t, uXXXX.
    """
    # Pattern: backslash followed by something that is NOT a valid escape char.
    return re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', s)


def preprocess_fields_json_escapes(raw_json: str) -> str:
    """
    Pre-process raw API response JSON to fix escape sequences inside fields_json.
    
    The AI returns fields_json as a nested JSON string. During outer JSON parsing,
    sequences like backslash-t in 'theta' get interpreted as tab characters.
    
    This function finds all fields_json values and:
    1. Escapes backslashes followed by valid escape chars + letters (LaTeX commands)
       e.g., 'theta' has 't' which is valid JSON escape, but 'heta' follows = LaTeX
    2. Escapes backslashes NOT followed by valid JSON escape chars
    """
    def fix_match(m: re.Match) -> str:
        prefix = m.group(1)  # "fields_json": "
        content = m.group(2)  # the actual JSON string content
        suffix = m.group(3)   # closing "
        
        # First: escape \X where X is a valid JSON escape char followed by letters
        # This catches \theta, \nu, \beta, \textit, etc.
        # r'\\' matches one backslash, capture the letter, then require more letters
        # Replace with double backslash + the captured chars
        fixed = re.sub(r'\\([bfnrtu])([a-zA-Z])', r'\\\\' + r'\1\2', content)
        
        # Second: escape \X where X is NOT a valid JSON escape char at all
        fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', fixed)
        
        return prefix + fixed + suffix
    
    # Match "fields_json": "..." handling escaped quotes
    pattern = r'("fields_json"\s*:\s*")((?:[^"\\]|\\.)*)(")'
    return re.sub(pattern, fix_match, raw_json)


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
                # Sanitize LaTeX-style escapes before JSON parsing
                raw_json = data.pop('fields_json')
                fixed_json = _fix_escape_sequences(raw_json)
                data['fields'] = json.loads(fixed_json)
        return data

class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool

class ReflectionResponse(BaseModel):
    reflection: str
    cards: List[AnkiCard]
    done: bool
