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
_NON_ALLOWED = re.compile(r"[^a-zA-Z0-9_\-:\s]+")
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
    
    # Deck name: preserve case, normalize
    if deck_name:
        # Handle existing deck hierarchy (deck::subdeck)
        deck_parts = [_normalize_segment(p) for p in deck_name.split("::") if p.strip()]
        parts.extend(deck_parts)
    
    # Slide set name: Title Case
    if slide_set_name:
        parts.append(_title_case_segment(_normalize_segment(slide_set_name)))
    
    # Topic: Title Case
    if topic:
        parts.append(_title_case_segment(_normalize_segment(topic)))
    
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


# Legacy function for backward compatibility
def build_grouped_tags(deck_name: str, tags: Iterable[str]) -> List[str]:
    """Return tags grouped under deck hierarchy (legacy 2-level format).

    DEPRECATED: Use build_hierarchical_tags for the new 4-level format.

    Examples:
        deck: "Econ::Macro", tag: "gdp" -> "econ::macro::gdp"
    """

    deck_path = _slug_segment(deck_name.replace("::", "-"))
    # Reconstruct with :: separators
    deck_parts = [_slug_segment(p) for p in deck_name.split("::") if p.strip()]
    deck_path = "::".join(deck_parts)
    
    normalized_tags = [_slug_segment(str(t)) for t in tags if isinstance(t, (str, int)) and str(t).strip()]

    if not deck_path:
        return normalized_tags

    prefix = deck_path + "::"
    return [prefix + t for t in normalized_tags]
