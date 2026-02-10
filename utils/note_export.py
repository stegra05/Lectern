"""
Shared note export utilities for Lectern.

This module consolidates the card → Anki note conversion logic used by both
the CLI and GUI code paths. Having a single implementation ensures consistency
and reduces maintenance burden.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import config
from anki_connector import add_note
from utils.tags import build_hierarchical_tags


@dataclass
class ExportResult:
    """Result of exporting a single card to Anki."""
    success: bool
    note_id: Optional[int] = None
    error: Optional[str] = None


def resolve_model_name(card_model: str, fallback_model: str) -> str:
    """Resolve AI-generated model names to configured Anki models.
    
    Maps generic names like "Basic" or "Cloze" to the user's configured
    note types (e.g., "Basic").
    
    Parameters:
        card_model: Model name from AI or card data
        fallback_model: Default model to use if card_model is empty
        
    Returns:
        Resolved Anki model name
    """
    model = str(card_model or "").strip() or str(fallback_model).strip()
    lower_model = model.lower()
    
    if lower_model in ("basic", config.DEFAULT_BASIC_MODEL.lower()):
        return config.DEFAULT_BASIC_MODEL
    elif lower_model in ("cloze", config.DEFAULT_CLOZE_MODEL.lower()):
        return config.DEFAULT_CLOZE_MODEL
    
    return model


def build_card_tags(
    card: Dict[str, Any],
    deck_name: str,
    slide_set_name: str,
    additional_tags: List[str],
) -> List[str]:
    """Build hierarchical tags for a card.
    
    Builds a 3-level hierarchical tag (Deck::SlideSet::Topic) plus any
    user-provided and default flat tags.
    
    Parameters:
        card: Card data from AI (uses 'slide_topic' for topic level)
        deck_name: Target Anki deck name
        slide_set_name: Inferred slide set name
        additional_tags: User-provided tags to append as flat tags
        
    Returns:
        List of tags: one hierarchical tag + any additional flat tags
    """
    # Merge user tags with default tag, preserving order and removing duplicates
    extra_tags = list(dict.fromkeys(additional_tags))
    
    # Add default tag if enabled
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
        if config.DEFAULT_TAG not in extra_tags:
            extra_tags.append(config.DEFAULT_TAG)
    
    # Get topic from card metadata
    slide_topic = str(card.get("slide_topic") or "").strip()
    
    # Build hierarchical tag (3-level) + flat additional tags
    return build_hierarchical_tags(
        deck_name=deck_name,
        slide_set_name=slide_set_name,
        topic=slide_topic,
        additional_tags=extra_tags,
    )


def export_card_to_anki(
    card: Dict[str, Any],
    deck_name: str,
    slide_set_name: str,
    fallback_model: str,
    additional_tags: List[str],
) -> ExportResult:
    """Export a single card to Anki.
    
    This is the unified export logic used by both CLI and GUI code paths.
    Handles model resolution, tag building, and note creation.
    
    Parameters:
        card: Card data from AI generation
        deck_name: Target Anki deck name
        slide_set_name: Inferred slide set name for hierarchical tags
        fallback_model: Model to use if card doesn't specify one
        additional_tags: User-provided tags to merge with AI tags
        
    Returns:
        ExportResult with success status, note_id, and any errors
    """
    try:
        # 1. Resolve model
        card_model = resolve_model_name(
            card.get("model_name", ""),
            fallback_model,
        )
        
        # 2. Extract fields
        note_fields = {
            str(k): str(v) 
            for k, v in (card.get("fields") or {}).items()
        }
        
        # 3. Build tags
        final_tags = build_card_tags(
            card=card,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            additional_tags=additional_tags,
        )
        
        # 4. Create note
        note_id = add_note(deck_name, card_model, note_fields, final_tags)
        
        return ExportResult(
            success=True,
            note_id=note_id,
        )
        
    except Exception as e:
        return ExportResult(
            success=False,
            error=str(e),
        )
