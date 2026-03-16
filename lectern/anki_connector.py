"""
AnkiConnect communication helpers.

This module provides a thin, typed wrapper around the AnkiConnect HTTP API to
add notes and store media files. It never manipulates the collection directly.
"""

from __future__ import annotations

import base64
import functools
import logging
import random
import time
from typing import Any, Callable, Dict, List, Optional, TypeVar

import requests

from lectern import config as _config

logger = logging.getLogger(__name__)


# --- Exception Hierarchy ---


class AnkiConnectError(RuntimeError):
    """Base exception for all AnkiConnect errors."""

    def __init__(self, message: str, *, retriable: bool = False) -> None:
        super().__init__(message)
        self.retriable = retriable


class AnkiTransportError(AnkiConnectError):
    """Error occurred at the transport level (connection, network, timeout).

    These errors are retriable - AnkiConnect may be temporarily unavailable.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, retriable=True)


class AnkiApiError(AnkiConnectError):
    """Error returned by AnkiConnect API (e.g., invalid action, deck not found).

    These errors are not retriable - the request itself is invalid.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, retriable=False)

# Caches for model field detection (lifecycle of the app)
_MODEL_FIELD_CACHE: Dict[str, List[str]] = {}
_MODEL_DETECTION_CACHE: Optional[Dict[str, str]] = None


def clear_model_caches() -> None:
    """Clear model field and detection caches.

    Call this when Anki's model configuration may have changed (e.g., after
    user modifies note types in Anki).
    """
    global _MODEL_DETECTION_CACHE
    _MODEL_FIELD_CACHE.clear()
    _MODEL_DETECTION_CACHE = None


# Retry configuration
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 0.5  # seconds
MAX_RETRY_DELAY = 4.0  # seconds

F = TypeVar("F", bound=Callable[..., Any])


def _with_retry(max_retries: int = MAX_RETRIES, initial_delay: float = INITIAL_RETRY_DELAY) -> Callable[[F], F]:
    """Decorator that adds exponential backoff retry logic for transport errors.

    Only retries on AnkiTransportError (connection-level errors).
    AnkiApiError and other exceptions fail immediately.
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exception: Optional[AnkiTransportError] = None
            delay = initial_delay

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except AnkiTransportError as e:
                    # Transport errors are retriable
                    last_exception = e
                    if attempt < max_retries:
                        logger.warning(
                            "AnkiConnect connection failed (attempt %d/%d), retrying in %.1fs: %s",
                            attempt + 1, max_retries + 1, delay, e
                        )
                        time.sleep(delay)
                        delay = min(delay * 2, MAX_RETRY_DELAY)
                        continue
                    # Final attempt exhausted - re-raise
                    raise
                except AnkiApiError:
                    # API-level errors are not retriable - raise immediately
                    raise

            # All retries exhausted
            raise last_exception

        return wrapper  # type: ignore
    return decorator


@_with_retry()
def _invoke(action: str, params: Optional[Dict[str, Any]] = None, timeout: int = 15) -> Any:
    """Invoke an AnkiConnect action with the given parameters.

    Raises:
        AnkiTransportError: If the connection fails (retried with exponential backoff).
        AnkiApiError: If AnkiConnect returns an API-level error.
    """
    payload = {"action": action, "version": 6}
    if params is not None:
        payload["params"] = params

    url = _config.ANKI_CONNECT_URL
    try:
        response = requests.post(url, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        raise AnkiTransportError(f"Failed to reach AnkiConnect at {url}: {exc}") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise AnkiTransportError(f"AnkiConnect returned non-JSON response: {exc}") from exc

    if data.get("error") is not None:
        raise AnkiApiError(f"AnkiConnect error for {action}: {data['error']}")

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
        raise AnkiApiError(f"Unexpected addNote result: {result}")
    return result


def update_note_fields(note_id: int, fields: Dict[str, str]) -> None:
    """Update fields of an existing Anki note via AnkiConnect."""
    _invoke("updateNoteFields", {"note": {"id": note_id, "fields": fields}})


def delete_notes(note_ids: List[int]) -> None:
    """Delete notes from Anki by their IDs via AnkiConnect."""
    _invoke("deleteNotes", {"notes": note_ids})





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
    """Fetch field names for a specific Anki note type/model (cached)."""
    if model_name in _MODEL_FIELD_CACHE:
        return _MODEL_FIELD_CACHE[model_name]
    try:
        result = _invoke("modelFieldNames", {"modelName": model_name})
        if isinstance(result, list):
            fields = [str(name) for name in result]
            _MODEL_FIELD_CACHE[model_name] = fields
            return fields
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

    Note:
        Results are cached for the app lifecycle to avoid repeated AnkiConnect API calls.
    """
    global _MODEL_DETECTION_CACHE
    if _MODEL_DETECTION_CACHE is not None:
        return _MODEL_DETECTION_CACHE

    detected = {"basic": "Basic", "cloze": "Cloze"}
    # Track if we've found canonical matches to avoid overwriting with variants
    found_canonical_basic = False
    found_canonical_cloze = False

    models = get_model_names()
    if not models:
        _MODEL_DETECTION_CACHE = detected
        return detected

    for name in models:
        fields = get_model_field_names(name)
        field_set = {f.strip() for f in fields}

        # Basic signature: contains Front and Back
        if "Front" in field_set and "Back" in field_set:
            if name == "Basic":
                # Canonical match - always prefer this
                detected["basic"] = name
                found_canonical_basic = True
            elif not found_canonical_basic:
                # Fallback for localized names (e.g., "Einfach")
                detected["basic"] = name

        # Cloze signature: contains Text (and usually no Front/Back)
        if "Text" in field_set and "Front" not in field_set:
            if name == "Cloze":
                # Canonical match - always prefer this
                detected["cloze"] = name
                found_canonical_cloze = True
            elif not found_canonical_cloze:
                # Fallback for localized names
                detected["cloze"] = name

    _MODEL_DETECTION_CACHE = detected
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
        if len(ids) > sample_size:
            ids = random.sample(ids, sample_size)
        else:
            ids = ids[:sample_size]
        infos = notes_info(ids)
        if not infos:
            return ""

        lines: List[str] = []
        for idx, info in enumerate(infos, start=1):
            fields_obj = info.get("fields", {}) if isinstance(info, dict) else {}
            model_name = str(info.get("modelName") or "Card").strip()
            field_lines: List[str] = []
            for field_name, field in fields_obj.items():
                if not isinstance(field, dict):
                    continue
                value = str(field.get("value", "") or "").strip()
                if not value:
                    continue
                compact_value = " ".join(value.split())
                field_lines.append(f"  {field_name}: {compact_value[:180]}")
            if not field_lines:
                continue
            lines.append(f"Example {idx} ({model_name}):")
            lines.extend(field_lines[:4])
            lines.append("")
        return "\n".join(lines).strip()
    except Exception as exc:
        logger.warning("Failed to sample examples from deck '%s': %s", deck_name, exc)
        return ""
