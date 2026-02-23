"""
AnkiConnect communication helpers.

This module provides a thin, typed wrapper around the AnkiConnect HTTP API to
add notes and store media files. It never manipulates the collection directly.
"""

from __future__ import annotations

import base64
import functools
import logging
import time
from typing import Any, Callable, Dict, List, Optional, TypeVar

import requests

from lectern import config as _config

logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 0.5  # seconds
MAX_RETRY_DELAY = 4.0  # seconds

F = TypeVar("F", bound=Callable[..., Any])


def _with_retry(max_retries: int = MAX_RETRIES, initial_delay: float = INITIAL_RETRY_DELAY) -> Callable[[F], F]:
    """Decorator that adds exponential backoff retry logic for transport errors.

    Only retries on connection-level errors (requests.RequestException).
    API-level errors (e.g., invalid action) fail immediately.
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[Exception] = None
            delay = initial_delay

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except RuntimeError as e:
                    # Only retry on transport errors, not API errors
                    error_msg = str(e)
                    if "Failed to reach AnkiConnect" in error_msg or "non-JSON response" in error_msg:
                        last_exception = e
                        if attempt < max_retries:
                            logger.warning(
                                "AnkiConnect connection failed (attempt %d/%d), retrying in %.1fs: %s",
                                attempt + 1, max_retries + 1, delay, e
                            )
                            time.sleep(delay)
                            delay = min(delay * 2, MAX_RETRY_DELAY)
                            continue
                    # API-level error or final attempt - raise immediately
                    raise

            # All retries exhausted
            raise last_exception

        return wrapper  # type: ignore
    return decorator


@_with_retry()
def _invoke(action: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15) -> Any:
    """Invoke an AnkiConnect action with the given parameters.

    Raises a RuntimeError with details if the call fails at the transport or
    API level. Transport errors are retried with exponential backoff.
    """
    payload = {"action": action, "version": 6}
    if params is not None:
        payload["params"] = params

    url = _config.ANKI_CONNECT_URL
    try:
        response = requests.post(url, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to reach AnkiConnect at {url}: {exc}") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"AnkiConnect returned non-JSON response: {exc}") from exc

    if data.get("error") is not None:
        raise RuntimeError(f"AnkiConnect error for {action}: {data['error']}")

    return data.get("result")


# Minimum supported AnkiConnect version
MIN_ANKICONNECT_VERSION = 6


def check_connection() -> bool:
    """Return True if AnkiConnect is reachable and responding."""

    try:
        _invoke("version", None, timeout=3)
        return True
    except Exception:
        return False


def get_connection_info() -> Dict[str, Any]:
    """Get detailed AnkiConnect connection information.

    Returns a dict with:
        - connected: bool
        - version: int or None
        - version_ok: bool (True if version >= MIN_ANKICONNECT_VERSION)
        - error: str or None
    """
    result: Dict[str, Any] = {
        "connected": False,
        "version": None,
        "version_ok": False,
        "error": None,
    }

    try:
        # Make a raw request to get version without retry decorator
        payload = {"action": "version", "version": 6}
        url = _config.ANKI_CONNECT_URL
        response = requests.post(url, json=payload, timeout=3)
        data = response.json()

        if data.get("error") is not None:
            result["error"] = f"AnkiConnect error: {data['error']}"
            return result

        version = data.get("result")
        result["version"] = version
        result["version_ok"] = isinstance(version, int) and version >= MIN_ANKICONNECT_VERSION
        result["connected"] = True

        if not result["version_ok"]:
            result["error"] = f"AnkiConnect version {version} is too old. Minimum required: {MIN_ANKICONNECT_VERSION}"

    except requests.RequestException as e:
        result["error"] = f"Cannot reach AnkiConnect at {url}: {e}"
    except ValueError as e:
        result["error"] = f"Invalid response from AnkiConnect: {e}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result


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


def update_note_fields(note_id: int, fields: Dict[str, str]) -> None:
    """Update fields of an existing Anki note via AnkiConnect."""
    _invoke("updateNoteFields", {"note": {"id": note_id, "fields": fields}})


def delete_notes(note_ids: List[int]) -> None:
    """Delete notes from Anki by their IDs via AnkiConnect."""
    _invoke("deleteNotes", {"notes": note_ids})


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
    except Exception as exc:
        logger.warning("Failed to fetch Anki tags: %s", exc)
        return []


def get_deck_names() -> List[str]:
    """Fetch all deck names from Anki via AnkiConnect."""
    try:
        result = _invoke("deckNames")
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch Anki deck names: %s", exc)
        return []


def get_model_names() -> List[str]:
    """Fetch all note-type (model) names from Anki via AnkiConnect."""
    try:
        result = _invoke("modelNames")
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch Anki model names: %s", exc)
        return []


def get_model_field_names(model_name: str) -> List[str]:
    """Fetch field names for a specific Anki note type/model."""
    try:
        result = _invoke("modelFieldNames", {"modelName": model_name})
        if isinstance(result, list):
            return [str(name) for name in result]
        return []
    except Exception as exc:
        logger.warning("Failed to fetch fields for model '%s': %s", model_name, exc)
        return []


def detect_builtin_models() -> Dict[str, str]:
    """Auto-detect localized names for Anki's built-in 'Basic' and 'Cloze' models.

    Uses field signatures (e.g. 'Front'/'Back' or 'Text') to identify the models
    even if their names are localized (e.g. 'Einfach' or 'Texte à trous').

    Returns:
        Mapping from canonical name ('basic', 'cloze') to actual localized name.
        Defaults to English names if detection fails or Anki is unreachable.
    """
    detected = {"basic": "Basic", "cloze": "Cloze"}

    models = get_model_names()
    if not models:
        return detected

    for name in models:
        fields = get_model_field_names(name)
        field_set = {f.strip() for f in fields}

        # Handle potential case-insensitivity or extra fields in user templates
        # Basic signature: precisely contains Front and Back
        if "Front" in field_set and "Back" in field_set:
            # If we see multiple matches, prefer the one exactly named "Basic"
            if name == "Basic" or detected["basic"] == "Basic":
                detected["basic"] = name

        # Cloze signature: precisely contains Text (and usually no Front/Back)
        if "Text" in field_set and "Front" not in field_set:
            if name == "Cloze" or detected["cloze"] == "Cloze":
                detected["cloze"] = name

    return detected


def create_deck(deck_name: str) -> bool:
    """Create a new deck in Anki via AnkiConnect.
    
    Returns:
        True if successful, False otherwise.
    """
    try:
        result = _invoke("createDeck", {"deck": deck_name})
        # createDeck returns the ID of the deck (int) on success
        return isinstance(result, int)
    except Exception as exc:
        logger.warning("Failed to create deck '%s': %s", deck_name, exc)
        return False


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
            values = [
                str(field.get("value", ""))
                for field in fields_obj.values()
                if isinstance(field, dict) and isinstance(field.get("value", ""), str)
            ]
            lines.append(f"Example {idx}:")
            for f_idx, value in enumerate(values, start=1):
                lines.append(f"  Field {f_idx}: {value}")
            lines.append("")
        return "\n".join(lines).strip()
    except Exception as exc:
        logger.warning("Failed to sample examples from deck '%s': %s", deck_name, exc)
        return ""
