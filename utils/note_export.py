"""
Shared note export utilities for Lectern.

This module consolidates the card → Anki note conversion logic used by both
the CLI and GUI code paths. Having a single implementation ensures consistency
and reduces maintenance burden.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import config
from anki_connector import add_note, store_media_file
from utils.tags import build_hierarchical_tags


@dataclass
class ExportResult:
    """Result of exporting a single card to Anki."""
    success: bool
    note_id: Optional[int] = None
    error: Optional[str] = None
    media_uploaded: List[str] = None
    
    def __post_init__(self):
        if self.media_uploaded is None:
            self.media_uploaded = []


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
    
    Combines AI-generated tags with user-provided tags and applies
    the 4-level hierarchical format: Deck::SlideSet::Topic::Tag
    
    Parameters:
        card: Card data from AI (may include 'tags' and 'slide_topic')
        deck_name: Target Anki deck name
        slide_set_name: Inferred slide set name
        additional_tags: User-provided tags to merge
        
    Returns:
        List of fully-qualified hierarchical tags
    """
    # Extract AI-generated tags
    ai_tags = [str(t) for t in (card.get("tags") or [])]
    
    # Merge with user tags, preserving order and removing duplicates
    merged_tags = list(dict.fromkeys(ai_tags + additional_tags))
    
    # Add default tag if enabled
    if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG:
        if config.DEFAULT_TAG not in merged_tags:
            merged_tags.append(config.DEFAULT_TAG)
    
    # Get topic from card metadata
    slide_topic = str(card.get("slide_topic") or "").strip()
    
    # Build hierarchical tags
    return build_hierarchical_tags(
        deck_name=deck_name,
        slide_set_name=slide_set_name,
        topic=slide_topic,
        tags=merged_tags,
    )


def upload_card_media(
    card: Dict[str, Any],
    card_index: int,
    on_upload: Optional[Callable[[str], None]] = None,
) -> List[str]:
    """Upload media files attached to a card.
    
    Parameters:
        card: Card data containing optional 'media' array
        card_index: Index for generating default filenames
        on_upload: Optional callback called with filename after each upload
        
    Returns:
        List of uploaded filenames
    """
    uploaded = []
    
    for media in card.get("media", []) or []:
        filename = media.get("filename", f"lectern-{card_index}.png")
        data_b64 = media.get("data", "")
        
        if data_b64:
            # Decode if string, else assume bytes
            data_bytes = base64.b64decode(data_b64) if isinstance(data_b64, str) else data_b64
            store_media_file(filename, data_bytes)
            uploaded.append(filename)
            
            if on_upload:
                on_upload(filename)
    
    return uploaded


def export_card_to_anki(
    card: Dict[str, Any],
    card_index: int,
    deck_name: str,
    slide_set_name: str,
    fallback_model: str,
    additional_tags: List[str],
    on_media_upload: Optional[Callable[[str], None]] = None,
) -> ExportResult:
    """Export a single card to Anki.
    
    This is the unified export logic used by both CLI and GUI code paths.
    Handles media upload, model resolution, tag building, and note creation.
    
    Parameters:
        card: Card data from AI generation
        card_index: Index for generating default media filenames
        deck_name: Target Anki deck name
        slide_set_name: Inferred slide set name for hierarchical tags
        fallback_model: Model to use if card doesn't specify one
        additional_tags: User-provided tags to merge with AI tags
        on_media_upload: Optional callback for media upload notifications
        
    Returns:
        ExportResult with success status, note_id, and any errors
    """
    try:
        # 1. Upload media
        media_uploaded = upload_card_media(card, card_index, on_media_upload)
        
        # 2. Resolve model
        card_model = resolve_model_name(
            card.get("model_name", ""),
            fallback_model,
        )
        
        # 3. Extract fields
        note_fields = {
            str(k): str(v) 
            for k, v in (card.get("fields") or {}).items()
        }
        
        # 4. Build tags
        final_tags = build_card_tags(
            card=card,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            additional_tags=additional_tags,
        )
        
        # 5. Create note
        note_id = add_note(deck_name, card_model, note_fields, final_tags)
        
        return ExportResult(
            success=True,
            note_id=note_id,
            media_uploaded=media_uploaded,
        )
        
    except Exception as e:
        return ExportResult(
            success=False,
            error=str(e),
        )
