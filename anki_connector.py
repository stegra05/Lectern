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


