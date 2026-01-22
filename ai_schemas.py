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
    
    NOTE(Escape-Fix): We must protect already-escaped backslashes (\\) first,
    otherwise \\alpha (valid) becomes \\\alpha (invalid).
    """
    # Step 0: Protect already-escaped backslashes with a placeholder
    placeholder = '\x00ESC_BS\x00'
    s = s.replace('\\\\', placeholder)
    
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
    
    # Step 4: Restore the protected escaped backslashes
    s = s.replace(placeholder, '\\\\')
    
    return s


def _aggressive_escape_fix(s: str) -> str:
    r"""
    Aggressively sanitize string for JSON parsing as a last resort.

    This function assumes that IF normal parsing failed, it is likely due to
    invalid escape sequences or control characters. It attempts to neutralize
    all backslashes except those that are clearly protecting other backslashes or quotes.

    It preserves:
    1. Double backslashes (\\)
    2. Escaped quotes (\")

    It escapes:
    1. EVERYTHING else, including valid escapes like \n, \t, etc.
       This turns \n (newline char) into \\n (literal string "\n").
    """
    # Step 1: Protect double backslashes
    placeholder_bs = '\x00ESC_BS\x00'
    s = s.replace('\\\\', placeholder_bs)

    # Step 2: Protect escaped quotes
    placeholder_qt = '\x00ESC_QT\x00'
    s = s.replace('\\"', placeholder_qt)

    # Step 3: Escape ALL remaining backslashes
    # This catches \n, \t, \alpha, etc. and turns them into \\n, \\t, \\alpha
    s = s.replace('\\', '\\\\')

    # Step 4: Restore placeholders
    s = s.replace(placeholder_qt, '\\"')
    s = s.replace(placeholder_bs, '\\\\')

    return s


def preprocess_fields_json_escapes(raw_json: str) -> str:
    """
    Pre-process raw API response JSON to fix escape sequences in string fields.
    
    The AI returns fields_json as a nested JSON string, and reflection/other fields
    may contain LaTeX. During JSON parsing, sequences like \\theta get interpreted
    as invalid escapes.
    
    This function finds string values in known fields and:
    1. Escapes backslashes followed by valid escape chars + letters (LaTeX commands)
       e.g., 'theta' has 't' which is valid JSON escape, but 'heta' follows = LaTeX
    2. Escapes backslashes NOT followed by valid JSON escape chars
    """
    def _fix_string_content(content: str) -> str:
        """Apply escape fixes to raw JSON string content.
        
        NOTE(Escape-Fix): We must protect already-escaped backslashes (\\) first,
        otherwise \\alpha (valid: escaped backslash + alpha) gets incorrectly 
        turned into \\\alpha (invalid: escaped backslash + invalid \a escape).
        """
        # Step 0: Protect already-escaped backslashes with a placeholder
        placeholder = '\x00ESC_BS\x00'
        fixed = content.replace('\\\\', placeholder)
        
        # Step 1: LaTeX starting with valid JSON escape char (excluding u)
        # e.g., \theta (\t + heta), \beta (\b + eta), \rho (\r + ho)
        fixed = re.sub(r'\\([bfnrt])([a-zA-Z])', r'\\\\' + r'\1\2', fixed)
        
        # Step 2: Invalid unicode escapes (\u not followed by 4 hex digits)
        fixed = re.sub(r'\\u(?![0-9a-fA-F]{4})', r'\\\\u', fixed)
        
        # Step 3: All remaining invalid escapes (backslash + non-valid char)
        fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', fixed)
        
        # Step 4: Restore the protected escaped backslashes
        fixed = fixed.replace(placeholder, '\\\\')
        
        return fixed
    
    def fix_match(m: re.Match) -> str:
        prefix = m.group(1)   # e.g. "fields_json": "
        content = m.group(2)  # the actual string content
        suffix = m.group(3)   # closing "
        return prefix + _fix_string_content(content) + suffix
    
    result = raw_json
    
    # NOTE(Escape-Fix): Fields that commonly contain LaTeX or special chars
    # fields_json is a nested JSON string, reflection contains prose with math
    fields_to_fix = ["fields_json", "reflection", "rationale"]
    
    for field_name in fields_to_fix:
        pattern = rf'("{field_name}"\s*:\s*")((?:[^"\\]|\\.)*)(")'
        result = re.sub(pattern, fix_match, result)
    
    # Also fix any remaining invalid escapes in the entire JSON that slipped through
    # This catches cases where invalid escapes are OUTSIDE the targeted fields
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
                    # strict=False allows control characters (like newlines) inside strings
                    data['fields'] = json.loads(fixed_json, strict=False)
                except Exception as e:
                    # Fallback: If parsing fails, try to salvage or provide error field
                    # Don't crash the whole batch for one bad card
                    print(f"WARNING: Failed to parse fields_json for card: {e}. Raw: {raw_json[:50]}...")
                    # Attempt a super-aggressive fix as last resort?
                    try:
                        # Neutralize most backslashes but preserve quotes
                        aggressive = _aggressive_escape_fix(raw_json)
                        data['fields'] = json.loads(aggressive, strict=False)
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
