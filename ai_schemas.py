from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator
import json
import re


def _fix_escape_sequences(s: str) -> str:
    r"""
    Sanitize invalid JSON escape sequences in a string.
    
    This handles three cases:
    1. LaTeX commands starting with valid escape chars (\times, \theta, \beta)
    2. Invalid unicode escapes (e.g. \u not followed by 4 hex digits, used for \unit, \user)
    3. General invalid escapes (\alpha, \sigma, etc.)
    
    Valid JSON escapes: \\ \" \/ \b \f \n \r \t \uXXXX
    """
    # 1. Catch LaTeX commands that START with a valid JSON escape letter (excluding 'u')
    # Examples: \times (\t), \theta, \rho, \beta (\b), \phi, \newline (\n)
    # Pattern: backslash + one of [bfnrt] + at least one more letter
    # We exclude 'u' here because we handle it specifically in step 2
    s = re.sub(r'\\([bfnrt])([a-zA-Z_])', r'\\\\\1\2', s)
    
    # 2. Catch \u sequences that are NOT valid unicode escapes (not followed by 4 hex digits)
    # This catches \unit, \user, C:\u, \u123 (short), etc.
    # We use negative lookahead to check if the next 4 chars are NOT hex
    s = re.sub(r'\\u(?![0-9a-fA-F]{4})', r'\\\\u', s)
    
    # 3. Catch all remaining invalid escapes (backslash + non-valid char)
    # Examples: \alpha, \(, \), \lambda, \gamma, \., etc.
    # Valid chars allowed after backslash: " \ / b f n r t u
    s = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', s)
    
    return s


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
        
        # Apply the same fixing logic as _fix_escape_sequences to the raw content
        # Note: Content here is the RAW string from the file, so it behaves slightly differently
        # than the parsed string, but the goal is to make it a valid JSON string value.
        
        fixed = content
        # 1. LaTeX starting with valid escape (excluding u)
        fixed = re.sub(r'\\([bfnrt])([a-zA-Z])', r'\\\\' + r'\1\2', fixed)
        
        # 2. Invalid unicode
        fixed = re.sub(r'\\u(?![0-9a-fA-F]{4})', r'\\\\u', fixed)
        
        # 3. General invalid escapes
        fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', fixed)
        
        return prefix + fixed + suffix
    
    # Match "fields_json": "..." handling escaped quotes
    pattern = r'("fields_json"\s*:\s*")((?:[^"\\]|\\.)*)(")'
    result = re.sub(pattern, fix_match, raw_json)
    
    # Also fix any remaining invalid escapes in the entire JSON that slipped through
    # This catches cases where invalid escapes are OUTSIDE fields_json
    # We only fix obvious invalid ones: \. \, \= \# \@ \( \) \{ \} etc.
    result = re.sub(r'\\([.=,#@(){}[\]<>])', r'\\\\\1', result)
    
    return result


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
                raw_json = data.pop('fields_json')
                # Try to clean up and parse
                try:
                    fixed_json = _fix_escape_sequences(raw_json)
                    data['fields'] = json.loads(fixed_json)
                except Exception as e:
                    # Fallback: If parsing fails, try to salvage or provide error field
                    # Don't crash the whole batch for one bad card
                    print(f"WARNING: Failed to parse fields_json for card: {e}. Raw: {raw_json[:50]}...")
                    # Attempt a super-aggressive fix as last resort?
                    try:
                        # Replace all backslashes with double backslashes
                        aggressive = raw_json.replace('\\', '\\\\')
                        data['fields'] = json.loads(aggressive)
                    except:
                        # Final fallback
                        data['fields'] = {
                            "Front": "Error parsing generated card content",
                            "Back": f"Raw content: {raw_json}",
                            "Error": str(e)
                        }
        return data

class CardGenerationResponse(BaseModel):
    cards: List[AnkiCard]
    done: bool

class ReflectionResponse(BaseModel):
    reflection: str
    cards: List[AnkiCard]
    done: bool
