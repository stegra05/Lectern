"""
AnkiConnect communication helpers.

This module provides a thin, typed wrapper around the AnkiConnect HTTP API to
add notes and store media files. It never manipulates the collection directly.
"""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

import requests

from config import ANKI_CONNECT_URL


def _invoke(action: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15) -> Any:
    """Invoke an AnkiConnect action with the given parameters.

    Raises a RuntimeError with details if the call fails at the transport or
    API level.
    """

    payload = {"action": action, "version": 6}
    if params is not None:
        payload["params"] = params

    try:
        response = requests.post(ANKI_CONNECT_URL, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to reach AnkiConnect at {ANKI_CONNECT_URL}: {exc}")

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"AnkiConnect returned non-JSON response: {exc}")

    if data.get("error") is not None:
        raise RuntimeError(f"AnkiConnect error for {action}: {data['error']}")

    return data.get("result")


def check_connection() -> bool:
    """Return True if AnkiConnect is reachable and responding."""

    try:
        _invoke("version", None, timeout=3)
        return True
    except Exception:
        return False


def add_note(deck_name: str, model_name: str, fields: Dict[str, str], tags: List[str]) -> int:
    """Add a single note to Anki via AnkiConnect.

    Parameters:
        deck_name: Name of the destination deck.
        model_name: Name of the note type/model (e.g., 'Basic', 'Cloze').
        fields: Mapping from field name to value.
        tags: Tags to attach to the note.

    Returns:
        The newly created note ID as an integer.
    """

    note = {
        "deckName": deck_name,
        "modelName": model_name,
        "fields": fields,
        "options": {"allowDuplicate": False},
        "tags": tags,
    }

    result = _invoke("addNote", {"note": note})
    if not isinstance(result, int):
        raise RuntimeError(f"Unexpected addNote result: {result}")
    return result


def store_media_file(filename: str, data: bytes) -> str:
    """Upload an image or other binary to Anki's media collection.

    Parameters:
        filename: Desired filename in Anki media folder.
        data: Raw bytes to upload. Will be base64-encoded for transport.

    Returns:
        The stored filename as returned by AnkiConnect.
    """

    b64 = base64.b64encode(data).decode("utf-8")
    result = _invoke("storeMediaFile", {"filename": filename, "data": b64})
    if not isinstance(result, str):
        raise RuntimeError(f"Unexpected storeMediaFile result: {result}")
    return result


def _escape_query_value(value: str) -> str:
    """Escape a value for inclusion in an AnkiConnect search query string."""

    return value.replace("\\", "\\\\").replace('"', '\\"')


def find_notes(query: str) -> List[int]:
    """Find note IDs matching an Anki search query string."""

    result = _invoke("findNotes", {"query": query})
    if not isinstance(result, list):
        return []
    return [int(nid) for nid in result if isinstance(nid, int) or (isinstance(nid, str) and str(nid).isdigit())]


def notes_info(note_ids: List[int]) -> List[Dict[str, Any]]:
    """Return notesInfo for the given note IDs."""

    if not note_ids:
        return []
    result = _invoke("notesInfo", {"notes": note_ids})
    if not isinstance(result, list):
        return []
    return [ri for ri in result if isinstance(ri, dict)]


def get_all_tags() -> List[str]:
    """Fetch all tags from Anki via AnkiConnect."""
    try:
        result = _invoke("getTags")
        if isinstance(result, list):
            return [str(t) for t in result]
        return []
    except Exception:
        return []


def get_deck_names() -> List[str]:
    """Fetch all deck names from Anki via AnkiConnect."""
    try:
        result = _invoke("deckNames")
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception:
        return []


def get_deck_slide_set_patterns(deck_name: str) -> Dict[str, Any]:
    """Analyze existing tags in a deck to detect slide set naming patterns.
    
    Looks for hierarchical tags matching: DeckName::SlideSetName::...
    Extracts the SlideSetName level and identifies common naming patterns.
    
    Parameters:
        deck_name: Name of the deck to analyze.
        
    Returns:
        Dict with:
        - 'slide_sets': List of existing slide set names found
        - 'pattern': Detected pattern type ('lecture', 'week', 'chapter', 'custom', or None)
        - 'next_number': Suggested next number if pattern detected
        - 'example': Example of the pattern for AI context
    """
    import re
    
    result = {
        'slide_sets': [],
        'pattern': None,
        'next_number': None,
        'example': None,
    }
    
    try:
        # Optimization: Try to find tags via notes in the deck first
        # This avoids fetching all tags (expensive) if the deck is small.
        tags_to_process: List[str] = []
        found_via_notes = False

        try:
             # Check deck size
             deck_query = _escape_query_value(deck_name)
             note_ids = find_notes(f'deck:"{deck_query}"')

             # If deck has reasonable size, fetch notes info
             if 0 < len(note_ids) < 2000:
                 infos = notes_info(note_ids)
                 found_tags = set()
                 for info in infos:
                     if isinstance(info, dict) and 'tags' in info and isinstance(info['tags'], list):
                         for t in info['tags']:
                             found_tags.add(str(t))
                 tags_to_process = list(found_tags)
                 found_via_notes = True
        except Exception as e:
            # Fallback to get_all_tags if findNotes fails
            print(f"Warning: Failed to fetch notes for tag analysis: {e}")
            pass

        if not found_via_notes:
             tags_to_process = get_all_tags()

        if not tags_to_process:
            return result

        all_tags = tags_to_process
        
        # Normalize deck name for matching
        deck_lower = deck_name.lower().replace(' ', '-').replace('_', '-')
        deck_parts = [p.strip().lower().replace(' ', '-') for p in deck_name.split('::')]
        
        # Find tags that start with this deck's hierarchy
        matching_slide_sets: List[str] = []
        
        for tag in all_tags:
            tag_parts = tag.split('::')
            if len(tag_parts) < 2:
                continue
            
            # Check if tag starts with deck name (case-insensitive, normalized)
            tag_deck_parts = [p.strip().lower().replace(' ', '-').replace('_', '-') 
                             for p in tag_parts[:len(deck_parts)]]
            
            if tag_deck_parts == deck_parts and len(tag_parts) > len(deck_parts):
                # Extract the slide set level (next level after deck)
                slide_set = tag_parts[len(deck_parts)]
                if slide_set and slide_set not in matching_slide_sets:
                    matching_slide_sets.append(slide_set)
        
        result['slide_sets'] = matching_slide_sets
        
        if not matching_slide_sets:
            return result
        
        # Detect naming patterns
        patterns = {
            'lecture': re.compile(r'^(?:lecture|lec)[-_\s]*(\d+)', re.IGNORECASE),
            'week': re.compile(r'^(?:week|wk)[-_\s]*(\d+)', re.IGNORECASE),
            'chapter': re.compile(r'^(?:chapter|ch|chap)[-_\s]*(\d+)', re.IGNORECASE),
            'module': re.compile(r'^(?:module|mod)[-_\s]*(\d+)', re.IGNORECASE),
            'session': re.compile(r'^(?:session|sess)[-_\s]*(\d+)', re.IGNORECASE),
            'unit': re.compile(r'^unit[-_\s]*(\d+)', re.IGNORECASE),
        }
        
        pattern_counts: Dict[str, List[int]] = {k: [] for k in patterns}
        
        for slide_set in matching_slide_sets:
            for pattern_name, pattern_re in patterns.items():
                match = pattern_re.match(slide_set)
                if match:
                    pattern_counts[pattern_name].append(int(match.group(1)))
                    break
        
        # Find the dominant pattern
        best_pattern = None
        best_count = 0
        best_numbers: List[int] = []
        
        for pattern_name, numbers in pattern_counts.items():
            if len(numbers) > best_count:
                best_pattern = pattern_name
                best_count = len(numbers)
                best_numbers = numbers
        
        if best_pattern and best_count > 0:
            result['pattern'] = best_pattern
            result['next_number'] = max(best_numbers) + 1 if best_numbers else 1
            
            # Provide example for AI context
            example_set = next(
                (s for s in matching_slide_sets 
                 if patterns[best_pattern].match(s)), 
                None
            )
            if example_set:
                result['example'] = example_set
        
        return result
        
    except Exception as e:
        print(f"Warning: Failed to analyze deck patterns: {e}")
        return result


def sample_examples_from_deck(deck_name: str, sample_size: int = 5) -> str:
    """Sample a few notes' fields from a deck via AnkiConnect and format as examples.

    Returns an empty string if no notes are found or an error occurs.
    """

    try:
        deck = _escape_query_value(deck_name)
        query = f'deck:"{deck}"'
        ids = find_notes(query)
        if not ids:
            return ""
        ids = ids[:sample_size]
        infos = notes_info(ids)
        if not infos:
            return ""

        lines: List[str] = []
        for idx, info in enumerate(infos, start=1):
            fields_obj = info.get("fields", {}) if isinstance(info, dict) else {}
            # fields_obj is a dict: { fieldName: { "value": str, ... }, ... }
            values: List[str] = []
            if isinstance(fields_obj, dict):
                for _fname, f in fields_obj.items():
                    if isinstance(f, dict):
                        v = f.get("value", "")
                        if isinstance(v, str):
                            values.append(v)
            lines.append(f"Example {idx}:")
            for f_idx, value in enumerate(values, start=1):
                lines.append(f"  Field {f_idx}: {value}")
            lines.append("")
        return "\n".join(lines).strip()
    except Exception:
        return ""

