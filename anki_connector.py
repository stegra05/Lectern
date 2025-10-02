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

