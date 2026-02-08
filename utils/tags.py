"""
Hierarchical tag utilities for Lectern.

Tag Format: DeckName::SlideSetName::Topic::Tag
Example: Introduction-to-Machine-Learning::Lecture-1-Supervised-Learning::Image-Classification::preprocessing

Simplified tag normalization - the AI generates most tags correctly.
"""

from __future__ import annotations

import re
from typing import Iterable, List

import config


def _clean_tag_part(value: str, title_case: bool = False, slug: bool = False) -> str:
    """Clean a string for use in Anki hierarchical tags.
    
    Single unified normalization function replacing the previous 4 functions.
    
    Args:
        value: Raw string to normalize
        title_case: If True, capitalize each word (preserving acronyms)
        slug: If True, lowercase the result (for leaf tags)
    """
    if not value:
        return ""
    
    # Clean: keep letters, digits, underscore, hyphen, spaces
    s = re.sub(r"[^a-zA-Z0-9_\-\s]+", "-", value).strip("- ")
    # Collapse multiple dashes/spaces
    s = re.sub(r"[-\s]{2,}", " ", s)
    
    if slug:
        s = s.lower()
    elif title_case:
        words = s.split()
        s = " ".join(w if w.isupper() or w.isdigit() else w.capitalize() for w in words)
    
    # Replace spaces with hyphens for tag format
    return s.replace(" ", "-")


def build_hierarchical_tag(
    deck_name: str,
    slide_set_name: str,
    topic: str,
    tag: str,
) -> str:
    """Build a single hierarchical tag: Deck::SlideSet::Topic::Tag."""
    parts = []
    
    # Deck: may already contain ::, split and clean each part
    if deck_name:
        parts.extend(_clean_tag_part(p) for p in deck_name.split("::") if p.strip())
    
    # Slide set and topic: Title Case
    if slide_set_name:
        parts.append(_clean_tag_part(slide_set_name, title_case=True))
    if topic:
        parts.append(_clean_tag_part(topic, title_case=True))
    
    # Tag (leaf): lowercase slug
    if tag:
        parts.append(_clean_tag_part(tag, slug=True))
    
    return "::".join(parts)


def build_hierarchical_tags(
    deck_name: str,
    slide_set_name: str,
    topic: str,
    tags: Iterable[str],
) -> List[str]:
    """Build multiple hierarchical tags with the same prefix."""
    return [
        build_hierarchical_tag(deck_name, slide_set_name, topic, str(t))
        for t in tags
        if isinstance(t, (str, int)) and str(t).strip()
    ]


def infer_slide_set_name(pdf_title: str, pdf_filename: str = "") -> str:
    """Infer slide set name from PDF title or filename.
    
    Note: The AI now returns slide_set_name in the concept map response,
    so this function is only used as a fallback.
    """
    # Use PDF title if it looks reasonable
    if pdf_title and len(pdf_title) < 80 and len(pdf_title.split()) <= 10:
        return _clean_tag_part(pdf_title, title_case=True)
    
    # Fallback: clean up filename
    if pdf_filename:
        clean_name = pdf_filename.replace('_', ' ').replace('-', ' ').strip()
        if clean_name and len(clean_name) > 3:
            return _clean_tag_part(clean_name, title_case=True)
    
    return ""


# NOTE: infer_slide_set_name_with_ai was removed - slide_set_name now comes from concept map
# NOTE: Legacy build_grouped_tags function removed in favor of build_hierarchical_tags
# The 4-level format (Deck::SlideSet::Topic::Tag) is now the only supported format.

