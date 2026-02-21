"""
Shared note export utilities for Lectern.

This module consolidates the card → Anki note conversion logic used by both
the CLI and GUI code paths. Having a single implementation ensures consistency
and reduces maintenance burden.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from lectern import config
from lectern.anki_connector import add_note, get_model_names, detect_builtin_models
from lectern.utils.tags import build_hierarchical_tags


logger = logging.getLogger(__name__)

# Cache of validated Anki model names (populated once per session).
_anki_models_cache: list[str] | None = None
# Cache of detected built-in model names (e.g. {"basic": "Einfach"})
_detected_builtins_cache: Dict[str, str] | None = None


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
    
    If Anki uses localized names (e.g. "Einfach"), this function auto-detects
    them matching the field signature.
    
    Parameters:
        card_model: Model name from AI or card data
        fallback_model: Default model to use if card_model is empty
        
    Returns:
        Resolved Anki model name
    """
    model = str(card_model or "").strip() or str(fallback_model).strip()
    lower_model = model.lower()
    
    # 1. Direct match with configured defaults
    if lower_model in ("basic", config.DEFAULT_BASIC_MODEL.lower()):
        resolved = config.DEFAULT_BASIC_MODEL
    elif lower_model in ("cloze", config.DEFAULT_CLOZE_MODEL.lower()):
        resolved = config.DEFAULT_CLOZE_MODEL
    else:
        resolved = model
    
    # 2. Validation and localized auto-detection
    if not _model_exists_in_anki(resolved):
        # Localized fallback logic:
        # If Anki doesn't have "Basic" but has "Einfach", we want to find it.
        builtins = _get_detected_builtins()
        
        # Determine if we are looking for a Basic or Cloze variant
        is_cloze = "cloze" in lower_model
        builtin_key = "cloze" if is_cloze else "basic"
        localized_name = builtins.get(builtin_key)
        
        if localized_name and localized_name != resolved and _model_exists_in_anki(localized_name):
            logger.info(
                "Auto-resolved '%s' to localized Anki model '%s'",
                resolved, localized_name
            )
            resolved = localized_name
        else:
            # Absolute fallback if detection also fails
            fallback = "Cloze" if is_cloze else "Basic"
            if resolved != fallback:
                logger.warning(
                    "Anki note type '%s' not found; falling back to '%s'",
                    resolved, fallback,
                )
            resolved = fallback
    
    return resolved


def _get_detected_builtins() -> Dict[str, str]:
    """Get or populate the cache of detected built-in model names."""
    global _detected_builtins_cache
    if _detected_builtins_cache is None:
        _detected_builtins_cache = detect_builtin_models()
    return _detected_builtins_cache


def _model_exists_in_anki(name: str) -> bool:
    """Return True if *name* is a valid Anki note type (cached per session)."""
    global _anki_models_cache
    if _anki_models_cache is None:
        _anki_models_cache = get_model_names()  # [] on connection failure
        if _anki_models_cache:
            logger.debug("Anki models cache loaded: %s", _anki_models_cache)
    # If we couldn't reach Anki, allow anything (export will fail anyway).
    if not _anki_models_cache:
        return True
    return name in _anki_models_cache


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
        def to_note_fields(payload: Dict[str, Any]) -> Dict[str, str]:
            explicit_fields = {
                str(k): str(v)
                for k, v in (payload.get("fields") or {}).items()
                if v is not None
            }
            if explicit_fields:
                return explicit_fields

            model = str(payload.get("model_name") or "").lower()
            if model == "cloze":
                text = str(payload.get("text") or "").strip()
                if text:
                    return {"Text": text}
            else:
                front = str(payload.get("front") or "").strip()
                back = str(payload.get("back") or "").strip()
                if front or back:
                    return {k: v for k, v in {"Front": front, "Back": back}.items() if v}
            return {}

        # 1. Resolve model
        card_model = resolve_model_name(
            card.get("model_name", ""),
            fallback_model,
        )
        
        # 2. Extract fields
        note_fields = to_note_fields(card)
        
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
