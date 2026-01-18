"""
Hierarchical tag utilities for Lectern.

Tag Format: DeckName::SlideSetName::Topic::Tag
Example: Introduction to Machine Learning::Lecture 1 Supervised Learning::Image Classification::Preprocessing

The tagging system is context-aware:
- Analyzes existing tags in the deck to detect naming patterns
- Uses PDF title extraction as fallback for slide set naming
- Maintains consistent naming schemes across a deck
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

import config


# Regex patterns for tag normalization
_NON_ALLOWED = re.compile(r"[^a-zA-Z0-9_\-\s]+")
_DUP_DASH = re.compile(r"-{2,}")
_DUP_SPACE = re.compile(r"\s{2,}")


def _normalize_segment(value: str, preserve_case: bool = True) -> str:
    """Normalize a string for use in Anki hierarchical tags.

    - Optionally preserve case (Title Case is often preferred)
    - Keep ascii letters, digits, underscore, hyphen, colon, and spaces
    - Collapse multiple hyphens/spaces
    - Trim leading/trailing hyphens and whitespace
    """

    s = (value or "").strip()
    if not preserve_case:
        s = s.lower()
    s = _NON_ALLOWED.sub("-", s)
    s = _DUP_DASH.sub("-", s)
    s = _DUP_SPACE.sub(" ", s)
    return s.strip("- ")


def _slug_segment(value: str) -> str:
    """Convert a string to kebab-case slug for tag compatibility.
    
    - lowercase
    - spaces become hyphens
    - keep ascii letters, digits, underscore, hyphen
    """
    s = _normalize_segment(value, preserve_case=False)
    s = s.replace(" ", "-")
    return s


def _title_case_segment(value: str) -> str:
    """Convert to Title Case while preserving existing acronyms/numbers.
    
    Examples:
        "lecture 1 supervised learning" -> "Lecture 1 Supervised Learning"
        "introduction to ML" -> "Introduction To ML"
    """
    words = value.split()
    result = []
    for word in words:
        # Preserve all-caps words (acronyms) and numbers
        if word.isupper() or word.isdigit():
            result.append(word)
        else:
            result.append(word.capitalize())
    return " ".join(result)


def _tag_segment(value: str, title_case: bool = False) -> str:
    """Normalize a segment and make it tag-safe (no spaces)."""
    s = _normalize_segment(value, preserve_case=True)
    if title_case:
        s = _title_case_segment(s)
    return s.replace(" ", "-")


def build_hierarchical_tag(
    deck_name: str,
    slide_set_name: str,
    topic: str,
    tag: str,
) -> str:
    """Build a single hierarchical tag in the format: Deck::SlideSet::Topic::Tag.
    
    Parameters:
        deck_name: Top-level deck name (e.g., "Introduction to Machine Learning")
        slide_set_name: Slide set identifier (e.g., "Lecture 1 Supervised Learning")
        topic: Topic/section within the slide set (e.g., "Image Classification")
        tag: Specific tag (e.g., "Preprocessing")
        
    Returns:
        Fully qualified hierarchical tag string.
    """
    parts = []
    
    # Deck name: preserve case, normalize, tag-safe
    if deck_name:
        # Handle existing deck hierarchy (deck::subdeck)
        deck_parts = [_tag_segment(p) for p in deck_name.split("::") if p.strip()]
        parts.extend(deck_parts)
    
    # Slide set name: Title Case, tag-safe
    if slide_set_name:
        parts.append(_tag_segment(slide_set_name, title_case=True))
    
    # Topic: Title Case, tag-safe
    if topic:
        parts.append(_tag_segment(topic, title_case=True))
    
    # Tag: kebab-case for the leaf level
    if tag:
        parts.append(_slug_segment(tag))
    
    return "::".join(parts)


def build_hierarchical_tags(
    deck_name: str,
    slide_set_name: str,
    topic: str,
    tags: Iterable[str],
) -> List[str]:
    """Build multiple hierarchical tags with the same prefix.
    
    Parameters:
        deck_name: Top-level deck name
        slide_set_name: Slide set identifier
        topic: Topic/section (can be empty if not specified)
        tags: List of leaf-level tags
        
    Returns:
        List of fully qualified hierarchical tags.
    """
    tags = list(tags)
    result = []
    for tag in tags:
        if isinstance(tag, (str, int)) and str(tag).strip():
            full_tag = build_hierarchical_tag(deck_name, slide_set_name, topic, str(tag))
            if full_tag:
                result.append(full_tag)
    return result


def infer_slide_set_name(
    pdf_title: str,
    pattern_info: Dict[str, Any],
    pdf_filename: str = "",
) -> str:
    """Infer a slide set name based on context.
    
    Priority:
    1. If pattern_info has a detected pattern, follow it
    2. If pdf_title contains structured info (e.g., "Lecture 5: Classification"), use it
    3. Clean up pdf_filename as fallback
    4. Return empty string to let AI decide
    
    Parameters:
        pdf_title: Title extracted from PDF content
        pattern_info: Dict from get_deck_slide_set_patterns() with pattern detection
        pdf_filename: Original PDF filename (without extension)
        
    Returns:
        Inferred slide set name, or empty string if AI should decide.
    """
    import re
    
    # Pattern prefixes for detection
    pattern_prefixes = {
        'lecture': 'Lecture',
        'week': 'Week',
        'chapter': 'Chapter',
        'module': 'Module',
        'session': 'Session',
        'unit': 'Unit',
    }
    
    # If we have a detected pattern, try to find a matching number in the PDF title/filename
    detected_pattern = pattern_info.get('pattern')
    if detected_pattern and detected_pattern in pattern_prefixes:
        prefix = pattern_prefixes[detected_pattern]
        next_num = pattern_info.get('next_number', 1)
        
        # Try to extract number from PDF title
        number_match = re.search(r'(\d+)', pdf_title or "")
        if number_match:
            num = number_match.group(1)
            # Remove the pattern prefix if present to get the topic part
            topic_part = re.sub(
                rf'^{detected_pattern}\s*\d+\s*[-:.]?\s*',
                '',
                pdf_title,
                flags=re.IGNORECASE
            ).strip()
            if topic_part:
                return f"{prefix} {num} {_title_case_segment(topic_part)}"
            return f"{prefix} {num}"
        
        # Try filename
        number_match = re.search(r'(\d+)', pdf_filename or "")
        if number_match:
            num = number_match.group(1)
            return f"{prefix} {num}"
    
    # No pattern detected - use PDF title if it looks like a good slide set name
    if pdf_title:
        # Check if title already has a structured format
        structured_match = re.match(
            r'^(lecture|week|chapter|module|session|unit)\s*(\d+)\s*[-:.]?\s*(.*)$',
            pdf_title,
            re.IGNORECASE
        )
        if structured_match:
            prefix = structured_match.group(1).capitalize()
            num = structured_match.group(2)
            topic = structured_match.group(3).strip()
            if topic:
                return f"{prefix} {num} {_title_case_segment(topic)}"
            return f"{prefix} {num}"
        
        # Title looks like a topic name, use it directly
        if len(pdf_title) < 80 and len(pdf_title.split()) <= 10:
            return _title_case_segment(pdf_title)
    
    # Fallback: clean up filename
    if pdf_filename:
        # Remove common prefixes/suffixes
        clean_name = re.sub(r'[-_]\d{4}[-_]\d{2}[-_]\d{2}', '', pdf_filename)  # Remove dates
        clean_name = re.sub(r'[-_]?v?\d+$', '', clean_name)  # Remove version numbers
        clean_name = clean_name.replace('_', ' ').replace('-', ' ')
        clean_name = _DUP_SPACE.sub(' ', clean_name).strip()
        if clean_name and len(clean_name) > 3:
            return _title_case_segment(clean_name)
    
    # Let AI decide
    return ""


def infer_slide_set_name_with_ai(
    pdf_filename: str,
    pdf_title: str,
    first_slides_text: List[str],
    pattern_info: Optional[Dict[str, Any]] = None,
) -> str:
    """Infer a semantic slide set name using a lightweight LLM.
    
    This function uses a small, fast model to generate a meaningful name
    based on context. Falls back to heuristic inference on failure.
    
    Parameters:
        pdf_filename: Original PDF filename (without extension)
        pdf_title: Title extracted via heuristics from PDF (may be generic)
        first_slides_text: Text content from the first 3 slides
        pattern_info: Optional dict with existing slide set patterns in the deck
        
    Returns:
        A semantic slide set name (e.g., "Lecture 2 Introduction To Machine Learning")
    """
    import config
    
    # Build context for the AI
    slides_context = "\n---\n".join(first_slides_text[:3]) if first_slides_text else ""
    
    # Truncate if too long (keep it cheap)
    if len(slides_context) > 2000:
        slides_context = slides_context[:2000] + "..."
    
    # Existing pattern context
    pattern_hint = ""
    if pattern_info:
        detected = pattern_info.get('pattern')
        existing_sets = pattern_info.get('slide_sets', [])
        if detected:
            pattern_hint = f"Existing naming pattern in this deck: {detected.capitalize()} N Topic (e.g., {', '.join(existing_sets[:2]) if existing_sets else 'Lecture 1 Introduction'})"
    
    prompt = f"""Generate a concise, semantic name for this lecture/slide set.

CONTEXT:
- Filename: {pdf_filename}
- Extracted title from PDF (may be generic): {pdf_title or 'None'}
{f'- {pattern_hint}' if pattern_hint else ''}

FIRST SLIDES CONTENT:
{slides_context}

RULES:
1. Use Title Case (e.g., "Lecture 2 Introduction To Machine Learning")
2. If there's a lecture/week/chapter number, include it
3. Focus on the TOPIC, not generic labels like "Week 1" or "Introduction"
4. Max 8 words
5. If filename is more informative than extracted title, prefer the filename's semantics

EXAMPLES of good names:
- "Lecture 2 Supervised Learning And Classification"
- "Week 3 Neural Networks Fundamentals"
- "Chapter 5 Regularization Techniques"

EXAMPLES of bad names (avoid these):
- "Week 1" (too generic, no topic)
- "Introduction" (no context)
- "Lecture Slides" (meaningless)"""

    # Structured output schema
    _SLIDE_SET_NAME_SCHEMA = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The semantic slide set name in Title Case, max 8 words"
            }
        },
        "required": ["name"]
    }

    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
        
        if not config.GEMINI_API_KEY:
            raise ValueError("No API key")
        
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        
        response = client.models.generate_content(
            model=config.LIGHTWEIGHT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_SLIDE_SET_NAME_SCHEMA,
                temperature=0.3,  # NOTE(Temperature): Conservative increase for Gemini 2.0 Flash Lite (lightweight model)
                max_output_tokens=100,
            )
        )
        
        # Parse structured output
        import json
        result_json = json.loads(response.text or "{}")
        result = result_json.get("name", "").strip()
        
        # Clean up: remove quotes, extra whitespace
        result = result.strip('"\'')
        result = _DUP_SPACE.sub(' ', result).strip()
        
        # Validate: not too short, not too long, not just numbers
        if result and 3 < len(result) < 100 and not result.isdigit():
            print(f"Info: AI inferred slide set name: '{result}'")
            return _title_case_segment(result)
        
    except Exception as e:
        print(f"Warning: AI slide set naming failed: {e}")
    
    # Fallback to heuristic inference
    return infer_slide_set_name(pdf_title, pattern_info or {}, pdf_filename)

# NOTE: Legacy build_grouped_tags function removed in favor of build_hierarchical_tags
# The 4-level format (Deck::SlideSet::Topic::Tag) is now the only supported format.
